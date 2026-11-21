// Alleen op de server. Haalt een recept-webpagina op (die je via de deel-knop naar Dish stuurt), zet hem om naar een recept
// en bewaart het met het label "Te controleren". Dubbels (zelfde titel) worden niet nog eens bewaard.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import { generateJson, RECIPE_SCHEMA, toScanResult } from "./scan.server";
import { mutateRecipes } from "./store.server";
import { htmlToText, parseJsonLdRecipe, type PageRecipe } from "./recipe-url";
import { normalizeTitle } from "./import.server";
import type { Recipe } from "./recipes";

export type UrlImportOutcome =
  | { ok: true; id: string; title: string; duplicate: boolean }
  | { ok: false; reason: "no-recipe" | "unreachable" | "limit" | "busy" | "error"; message: string };

const MAX_BYTES = 2_500_000;
const MAX_REDIRECTS = 5;

/** Binnenlands, loopback, link-local, Tailscale (CGNAT) en andere adressen waar Dish nooit naartoe mag fetchen (SSRF). */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || /^fe[89ab]/.test(v6);
}

/** DNS-lookup die geblokkeerde adressen weigert. Omdat de verbinding het resultaat hiervan gebruikt, kan DNS-rebinding er niet omheen. */
const safeLookup = ((host: string, opts: { all?: boolean }, cb: (err: Error | null, addr?: unknown, family?: number) => void) => {
  dns.lookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) return cb(new Error("Dit adres is niet toegestaan"));
    // Node vraagt (bij autoSelectFamily) om een lijst, anders om één adres.
    if (opts?.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}) as unknown as net.LookupFunction;

function get(url: URL): Promise<{ status: number; location?: string; type: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, {
      method: "GET",
      lookup: safeLookup,
      timeout: 15_000,
      headers: {
        "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "nl-BE,nl;q=0.9,en;q=0.6",
        "accept-encoding": "gzip, deflate, br",
      },
    }, (res) => {
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      const stream: NodeJS.ReadableStream =
        enc === "gzip" ? res.pipe(zlib.createGunzip())
        : enc === "deflate" ? res.pipe(zlib.createInflate())
        : enc === "br" ? res.pipe(zlib.createBrotliDecompress())
        : res;
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(new Error("Pagina is te groot")); return; }
        chunks.push(c);
      });
      stream.on("end", () => resolve({
        status: res.statusCode ?? 0,
        location: res.headers.location,
        type: String(res.headers["content-type"] ?? ""),
        body: Buffer.concat(chunks),
      }));
      stream.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Time-out")));
    req.on("error", reject);
    req.end();
  });
}

/** Haalt een pagina op en volgt redirects, waarbij elke stap opnieuw gecontroleerd wordt. */
export async function fetchPage(input: string): Promise<{ finalUrl: string; html: string }> {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Alleen http- en https-links worden ondersteund");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && isBlockedAddress(host)) throw new Error("Dit adres is niet toegestaan");
    const res = await get(url);
    if (res.status >= 300 && res.status < 400 && res.location) { url = new URL(res.location, url); continue; }
    if (res.status < 200 || res.status >= 300) throw new Error(`De website antwoordde met fout ${res.status}`);
    if (!/html|xml|text\/plain/i.test(res.type)) throw new Error("Dit is geen webpagina");
    const charset = res.type.match(/charset=([\w-]+)/i)?.[1] ?? "utf-8";
    let html: string;
    try { html = new TextDecoder(charset).decode(res.body); } catch { html = new TextDecoder("utf-8").decode(res.body); }
    return { finalUrl: url.toString(), html };
  }
  throw new Error("Te veel doorverwijzingen");
}

const URL_PROMPT = `Hieronder staat een recept van een website (als gegevens of als platte paginatekst). Zet het om naar het gevraagde JSON-formaat.
Regels:
- Schrijf alles in het Nederlands (Vlaams). Staat het recept in een andere taal, vertaal het dan; hoeveelheden en eenheden blijven zoals ze zijn.
- Ingrediënten: één per regel, met hoeveelheid en eenheid vooraan (bv. "500 g tomaten"). Geen kopjes.
- Bereiding: één stap per item, zonder nummering. Neem geen reclame, reacties, navigatie of verwante recepten mee.
- Verzin niets bij. Staat het aantal personen of de bereidingstijd er niet bij, laat die dan leeg (null).
- Staat er een tip of opmerking van de auteur bij, zet die in "notities".
- "glutenvrij_voorstel": alleen true als je zeker bent dat ELK ingrediënt glutenvrij is; bij twijfel false. "gluten_reden": noem kort de ingrediënten met gluten of twijfel.
- "categorie": kies de best passende soort. Gebruik "overige" voor hummus, dips, sauzen, hapjes, snacks en alles wat niet in de andere soorten past.
- Staat er geen recept op de pagina, geef dan een lege titel en lege lijsten.`;

export async function importFromUrl(rawUrl: string): Promise<UrlImportOutcome> {
  let page: { finalUrl: string; html: string };
  try {
    page = await fetchPage(rawUrl);
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause;
    console.error("Pagina ophalen mislukt", rawUrl, e);
    const msg = (e as Error).message;
    return { ok: false, reason: "unreachable", message: cause?.code === "ENOTFOUND" ? "Deze website bestaat niet" : msg || "Pagina kon niet opgehaald worden" };
  }

  const structured = parseJsonLdRecipe(page.html);
  let recipe: PageRecipe | null = structured;

  // Met Gemini vertalen en opkuisen; lukt dat niet, dan geldt het schema.org-recept zoals het is.
  if (process.env.GEMINI_API_KEY) {
    const source = structured
      ? `Recept (schema.org-gegevens):\n${JSON.stringify(structured)}`
      : `Paginatekst:\n${htmlToText(page.html)}`;
    const out = await generateJson([{ text: `${source}\n\n${URL_PROMPT}` }], RECIPE_SCHEMA);
    if (out.ok) {
      try {
        const r = toScanResult(JSON.parse(out.text) as Record<string, unknown>);
        if (r.title && (r.ingredients.length || r.steps.length)) recipe = r;
        else if (!structured) return { ok: false, reason: "no-recipe", message: "Ik vond geen recept op die pagina" };
      } catch { /* val terug op structured */ }
    } else if (!structured) {
      return { ok: false, reason: out.reason === "no-key" ? "error" : out.reason, message: out.message };
    }
  }
  if (!recipe || !recipe.title || !(recipe.ingredients.length || recipe.steps.length)) {
    return {
      ok: false,
      reason: "no-recipe",
      message: process.env.GEMINI_API_KEY ? "Ik vond geen recept op die pagina" : "Op deze pagina staat geen leesbaar recept, en er is geen Gemini-sleutel om de tekst zelf te lezen",
    };
  }

  const r = recipe;
  const source = `Bron: ${page.finalUrl}`;
  return mutateRecipes((all) => {
    const existing = all.find((x) => normalizeTitle(x.title) === normalizeTitle(r.title));
    if (existing) return { ok: true as const, id: existing.id, title: existing.title, duplicate: true };
    const now = new Date().toISOString();
    const created: Recipe = {
      id: crypto.randomUUID(),
      title: r.title,
      category: r.category,
      servings: r.servings ?? 4,
      prepMinutes: r.prepMinutes,
      ingredients: r.ingredients.slice(0, 200),
      steps: r.steps.slice(0, 200),
      notes: [r.notes, source].filter(Boolean).join("\n\n").slice(0, 10000),
      glutenFree: false, // alleen de gebruiker bevestigt dit
      needsReview: true,
      image: null,
      rating: 0,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    all.push(created);
    return { ok: true as const, id: created.id, title: created.title, duplicate: false };
  });
}
