// Zuivere hulpfuncties (geen Node-API's) om een recept uit een webpagina te halen: de gedeelde link vinden,
// schema.org/Recipe (JSON-LD) lezen en als terugval de pagina-tekst netjes maken voor Gemini.
import type { CategoryId } from "./recipes";

const URL_RE = /https?:\/\/[^\s<>"']+/i;

/** Haalt de link uit wat een deel-knop doorgeeft. Veel apps zetten de link in `text` (soms met een zin ervoor) in plaats van in `url`. */
export function extractSharedUrl(p: { url?: string; text?: string; title?: string }): string | null {
  for (const src of [p.url, p.text, p.title]) {
    const m = src?.match(URL_RE);
    if (m) return m[0].replace(/[).,;!?]+$/, "");
  }
  return null;
}

export function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", euml: "ë", ecirc: "ê", agrave: "à", ccedil: "ç", ouml: "ö", uuml: "ü", iuml: "ï", deg: "°", frac12: "½", frac14: "¼", frac34: "¾", hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘" };
  return s.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return named[e.toLowerCase()] ?? all;
  });
}

// Blok-tags worden een spatie, inline-tags (<b>, <i>) verdwijnen zonder spatie, zodat "<b>woord</b>." heel blijft.
const clean = (v: unknown) =>
  decodeEntities(String(v ?? "").replace(/<\/?(br|p|div|li|ul|ol|h\d)\b[^>]*>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** ISO 8601-duur (PT1H30M) naar minuten. */
export function isoMinutes(v: unknown): number | null {
  const m = String(v ?? "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const total = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return total > 0 ? total : null;
}

function collectRecipes(node: unknown, out: Record<string, unknown>[]) {
  if (Array.isArray(node)) { node.forEach((n) => collectRecipes(n, out)); return; }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const type = o["@type"];
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) out.push(o);
  if (o["@graph"]) collectRecipes(o["@graph"], out);
}

function instructionSteps(v: unknown): string[] {
  if (typeof v === "string") return v.split(/\r?\n+/).map(clean).filter(Boolean);
  if (!Array.isArray(v)) return v && typeof v === "object" ? instructionSteps([v]) : [];
  return v.flatMap((s): string[] => {
    if (typeof s === "string") return [clean(s)].filter(Boolean);
    if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      if (o.itemListElement) return instructionSteps(o.itemListElement); // HowToSection
      const t = clean(o.text ?? o.name);
      return t ? [t] : [];
    }
    return [];
  });
}

function guessCategory(raw: string): CategoryId {
  const s = raw.toLowerCase();
  if (/soep|soup|bouillon|velouté/.test(s)) return "soep";
  if (/dessert|nagerecht|zoet|pudding|ijs\b|mousse|taart|pie\b/.test(s)) return "dessert";
  if (/brood|bread|gebak|cake|koek|cookie|bak\b|muffin|brownie|cupcake/.test(s)) return "gebak-brood";
  if (/hapje|snack|dip|hummus|saus|sauce|borrel|appetizer|voorgerecht|starter|spread/.test(s)) return "overige";
  return "hoofdgerecht";
}

export type PageRecipe = {
  title: string;
  category: CategoryId;
  servings: number | null;
  prepMinutes: number | null;
  ingredients: string[];
  steps: string[];
  notes: string;
};

/** Zoekt het eerste schema.org/Recipe in de JSON-LD-blokken van een pagina. Geeft null als er geen bruikbaar recept in zit. */
export function parseJsonLdRecipe(html: string): PageRecipe | null {
  const found: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectRecipes(JSON.parse(m[1].trim()), found); } catch { /* kapotte JSON-LD overslaan */ }
  }
  const r = found.find((x) => Array.isArray(x.recipeIngredient) && x.recipeIngredient.length);
  if (!r) return null;

  const ingredients = (r.recipeIngredient as unknown[]).map(clean).filter(Boolean);
  const steps = instructionSteps(r.recipeInstructions);
  const yieldRaw = Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield;
  const servings = Math.round(Number(String(yieldRaw ?? "").match(/\d+/)?.[0]));
  const categoryText = [r.recipeCategory, r.keywords, r.name].flat().map((x) => String(x ?? "")).join(" ");

  return {
    title: clean(r.name).slice(0, 200),
    category: guessCategory(categoryText),
    servings: Number.isFinite(servings) && servings > 0 ? Math.min(servings, 100) : null,
    prepMinutes: isoMinutes(r.totalTime) ?? isoMinutes(r.prepTime),
    ingredients,
    steps,
    notes: clean(r.description).slice(0, 1000),
  };
}

/** Maakt van een HTML-pagina platte tekst (zonder scripts, menu's en voettekst) voor het geval er geen JSON-LD is. */
export function htmlToText(html: string, max = 60_000): string {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const body = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article|ul|ol)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .split("\n").map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim()).filter(Boolean).join("\n");
  return `${title}\n\n${text}`.slice(0, max);
}
