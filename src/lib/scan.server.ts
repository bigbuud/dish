// Alleen op de server. Leest een foto van een recept (ook handgeschreven) met Google Gemini en geeft een nette, gestructureerde versie terug.
// Vereist GEMINI_API_KEY (gratis aan te maken in Google AI Studio); zonder sleutel valt de app terug op de lokale OCR (tesseract) in de browser.
// Kommalijst: de eerste die werkt wint. Bij 404 (model bestaat niet/niet voor jouw sleutel) of 429 (limiet) probeert Dish de volgende.
import { CATEGORY_IDS, type CategoryId } from "./recipes";

const MODELS = () =>
  (process.env.GEMINI_MODEL || "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite")
    .split(",").map((m) => m.trim()).filter(Boolean);
const API = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export const PROMPT = `Dit is een foto van een recept: een kookboekpagina, een uitgeprinte pagina, een handgeschreven briefje of een schrift. De tekst is meestal Nederlands (Vlaams).
Lees de volledige tekst en zet het om naar een net recept in het gevraagde JSON-formaat.
Regels:
- Schrijf de tekst zoals hij er staat, maar verbeter duidelijke leesfouten en spelling. Verzin niets bij.
- Ingrediënten: één per regel, met hoeveelheid en eenheid vooraan (bv. "500 g tomaten"). Laat kopjes zoals "Ingrediënten" weg.
- Bereiding: één stap per item, zonder nummering. Voeg doorlopende zinnen die over meerdere regels lopen samen.
- Staat er een oventemperatuur, tip of opmerking, zet die in "notities".
- Is een woord echt onleesbaar, schrijf dan je beste gok gevolgd door [?].
- Staat het aantal personen of de bereidingstijd er niet bij, laat die dan leeg (null).
- "glutenvrij_voorstel": zet alleen true als je zeker bent dat ELK ingrediënt glutenvrij is. Gluten zit in tarwe, rogge, gerst, spelt, bloem, broodkruim, pasta, couscous, bier, sojasaus, worst en gehakt met vulling. Bij twijfel (bouillonblokjes, sauzen, kruidenmengsels, haver, kant-en-klare producten) zet je false. Wees streng: een foutieve true is erger dan een foutieve false.
- "gluten_reden": noem kort de ingrediënten die gluten bevatten of waarover twijfel bestaat (bv. "bloem, bouillonblokjes"). Leeg als er niets verdacht is.
- "categorie": kies de best passende soort. Gebruik "overige" voor hummus, dips, sauzen, hapjes, snacks en alles wat niet in de andere soorten past.`;

export type ScanResult = {
  title: string;
  category: CategoryId;
  servings: number | null;
  prepMinutes: number | null;
  ingredients: string[];
  steps: string[];
  notes: string;
  /** Alleen een voorstel van Gemini; de gebruiker beslist. */
  glutenFreeSuggestion: boolean;
  glutenReason: string;
};

export type ScanOutcome =
  | { ok: true; recipe: ScanResult }
  | { ok: false; reason: "no-key" | "error"; message?: string };

/** Onderdelen van een Gemini-bericht: een bestand (base64) of tekst. */
export type GeminiPart = { inline_data: { mime_type: string; data: string } } | { text: string };

export type GeminiOutcome =
  | { ok: true; text: string }
  // limit = 429 (limiet bereikt), busy = Google overbelast of geen antwoord: beide zijn het waard om later opnieuw te proberen.
  | { ok: false; reason: "no-key" | "limit" | "busy" | "error"; message: string };

const RECIPE_PROPERTIES = {
  titel: { type: "STRING" },
  categorie: { type: "STRING", enum: [...CATEGORY_IDS] },
  personen: { type: "INTEGER", nullable: true },
  bereidingstijd_minuten: { type: "INTEGER", nullable: true },
  ingredienten: { type: "ARRAY", items: { type: "STRING" } },
  bereiding: { type: "ARRAY", items: { type: "STRING" } },
  notities: { type: "STRING" },
  glutenvrij_voorstel: { type: "BOOLEAN" },
  gluten_reden: { type: "STRING" },
};
const RECIPE_REQUIRED = ["titel", "categorie", "ingredienten", "bereiding"];

export const RECIPE_SCHEMA = { type: "OBJECT", properties: RECIPE_PROPERTIES, required: RECIPE_REQUIRED };
export const RECIPES_SCHEMA = {
  type: "OBJECT",
  properties: { recepten: { type: "ARRAY", items: RECIPE_SCHEMA } },
  required: ["recepten"],
};

/** Vraagt Gemini om JSON volgens `schema`. Probeert de modellen één voor één en wacht bij overbelasting (zie de opmerkingen hieronder). */
export async function generateJson(parts: GeminiPart[], schema: object): Promise<GeminiOutcome> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, reason: "no-key", message: "Geen Gemini-sleutel" };

  try {
    const call = (model: string, thinking: boolean) => fetch(API(model), {
      method: "POST",
      signal: AbortSignal.timeout(40_000),
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.1,
          // Lezen hoeft niet lang "na te denken": scheelt veel wachttijd. Sommige modellen kennen dit veld niet; dan proberen we zonder.
          ...(thinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
    });
    let res: Response | undefined;
    let lastStatus = 0; // 0 = geen antwoord (time-out of netwerkfout)
    let lastError = "";
    const started = Date.now();
    // Per model: eerst met weinig "denkwerk"; kent het model dat niet (400), dan zonder. Bij 503/500/502/504, 403/404, 429 of een time-out volgt het volgende model.
    // Tweede ronde (na 3 s) alleen als Google overbelast was (503) en er nog tijd is.
    for (let round = 0; round < 2 && !res?.ok; round++) {
      if (round > 0) {
        if (lastStatus !== 503 || Date.now() - started > 60_000) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      for (const model of MODELS()) {
        let thinking = true;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            res = await call(model, thinking);
            lastStatus = res.status;
            lastError = "";
          } catch (e) {
            const cause = (e as { cause?: { code?: string; message?: string } }).cause;
            lastStatus = 0;
            lastError = cause?.code ?? cause?.message ?? (e as Error).message;
            console.error(`Gemini scan mislukt (${model})`, e);
            res = undefined;
            break;
          }
          if (res.ok) break;
          const body = await res.text().catch(() => "");
          console.error(`Gemini scan mislukt (${model})`, res.status, body.slice(0, 500));
          if (res.status === 400 && thinking) { thinking = false; continue; }
          break;
        }
        if (res?.ok) break;
        if (res && ![403, 404, 429, 500, 502, 503, 504].includes(res.status)) return { ok: false, reason: "error", message: `API-fout ${res.status}` };
      }
    }
    if (!res?.ok) {
      const message =
        lastStatus === 429 ? "Daglimiet bereikt"
        : lastStatus === 503 ? "Google is overbelast, probeer zo opnieuw"
        : lastStatus === 0 ? `geen antwoord van Google: ${lastError}`
        : `API-fout ${lastStatus}`;
      const reason = lastStatus === 429 ? "limit" : lastStatus === 503 || lastStatus === 0 ? "busy" : "error";
      return { ok: false, reason, message };
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) return { ok: false, reason: "error", message: "Geen antwoord" };
    return { ok: true, text };
  } catch (e) {
    // "fetch failed" verbergt de echte reden in e.cause (ENOTFOUND = DNS, ETIMEDOUT/ENETUNREACH = geen route, ...).
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? (e as Error).message;
    console.error("Gemini scan mislukt", e);
    return { ok: false, reason: "busy", message: `geen verbinding met Google: ${detail}` };
  }
}

/** Zet één recept-object uit Gemini om naar een veilig ScanResult. */
export function toScanResult(r: Record<string, unknown>): ScanResult {
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
  const num = (v: unknown, max: number) => {
    const n = Math.round(Number(v));
    return v != null && Number.isFinite(n) && n > 0 ? Math.min(n, max) : null;
  };
  return {
    title: String(r.titel ?? "").trim().slice(0, 200),
    category: CATEGORY_IDS.find((c) => c === r.categorie) ?? "hoofdgerecht",
    servings: num(r.personen, 100),
    prepMinutes: num(r.bereidingstijd_minuten, 10000),
    ingredients: list(r.ingredienten),
    steps: list(r.bereiding),
    notes: String(r.notities ?? "").trim(),
    glutenFreeSuggestion: r.glutenvrij_voorstel === true,
    glutenReason: String(r.gluten_reden ?? "").trim().slice(0, 300),
  };
}

export async function scanWithGemini(dataUrl: string): Promise<ScanOutcome> {
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!process.env.GEMINI_API_KEY) return { ok: false, reason: "no-key" };
  if (!m) return { ok: false, reason: "error", message: "Onbekend afbeeldingsformaat" };

  const out = await generateJson([{ inline_data: { mime_type: m[1], data: m[2] } }, { text: PROMPT }], RECIPE_SCHEMA);
  if (!out.ok) return { ok: false, reason: out.reason === "no-key" ? "no-key" : "error", message: out.message };
  try {
    return { ok: true, recipe: toScanResult(JSON.parse(out.text) as Record<string, unknown>) };
  } catch {
    return { ok: false, reason: "error", message: "Antwoord van Gemini was onleesbaar" };
  }
}
