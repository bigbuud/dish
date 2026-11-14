// Alleen op de server. Leest een foto van een recept (ook handgeschreven) met Google Gemini en geeft een nette, gestructureerde versie terug.
// Vereist GEMINI_API_KEY (gratis aan te maken in Google AI Studio); zonder sleutel valt de app terug op de lokale OCR (tesseract) in de browser.
// Kommalijst: de eerste die werkt wint. Bij 404 (model bestaat niet/niet voor jouw sleutel) of 429 (limiet) probeert Dish de volgende.
const MODELS = () =>
  (process.env.GEMINI_MODEL || "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite")
    .split(",").map((m) => m.trim()).filter(Boolean);
const API = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const PROMPT = `Dit is een foto van een recept: een kookboekpagina, een uitgeprinte pagina, een handgeschreven briefje of een schrift. De tekst is meestal Nederlands (Vlaams).
Lees de volledige tekst en zet het om naar een net recept in het gevraagde JSON-formaat.
Regels:
- Schrijf de tekst zoals hij er staat, maar verbeter duidelijke leesfouten en spelling. Verzin niets bij.
- Ingrediënten: één per regel, met hoeveelheid en eenheid vooraan (bv. "500 g tomaten"). Laat kopjes zoals "Ingrediënten" weg.
- Bereiding: één stap per item, zonder nummering. Voeg doorlopende zinnen die over meerdere regels lopen samen.
- Staat er een oventemperatuur, tip of opmerking, zet die in "notities".
- Is een woord echt onleesbaar, schrijf dan je beste gok gevolgd door [?].
- Staat het aantal personen of de bereidingstijd er niet bij, laat die dan leeg (null).
- "categorie": kies de best passende soort.`;

export type ScanResult = {
  title: string;
  category: "soep" | "hoofdgerecht" | "dessert" | "gebak-brood";
  servings: number | null;
  prepMinutes: number | null;
  ingredients: string[];
  steps: string[];
  notes: string;
};

export type ScanOutcome =
  | { ok: true; recipe: ScanResult }
  | { ok: false; reason: "no-key" | "error"; message?: string };

export async function scanWithGemini(dataUrl: string): Promise<ScanOutcome> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, reason: "no-key" };

  const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return { ok: false, reason: "error", message: "Onbekend afbeeldingsformaat" };

  try {
    const call = (model: string) => fetch(API(model), {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: m[1], data: m[2] } }, { text: PROMPT }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              titel: { type: "STRING" },
              categorie: { type: "STRING", enum: ["soep", "hoofdgerecht", "dessert", "gebak-brood"] },
              personen: { type: "INTEGER", nullable: true },
              bereidingstijd_minuten: { type: "INTEGER", nullable: true },
              ingredienten: { type: "ARRAY", items: { type: "STRING" } },
              bereiding: { type: "ARRAY", items: { type: "STRING" } },
              notities: { type: "STRING" },
            },
            required: ["titel", "categorie", "ingredienten", "bereiding"],
          },
        },
      }),
    });
    let res: Response | undefined;
    let lastStatus = 0;
    for (const model of MODELS()) {
      res = await call(model);
      if (res.ok) break;
      lastStatus = res.status;
      const body = await res.text().catch(() => "");
      console.error(`Gemini scan mislukt (${model})`, res.status, body.slice(0, 500));
      if (![403, 404, 429].includes(res.status)) break; // alleen bij "bestaat niet / limiet" het volgende model proberen
    }
    if (!res?.ok) {
      return { ok: false, reason: "error", message: lastStatus === 429 ? "Daglimiet bereikt" : `API-fout ${lastStatus || "geen verbinding"}` };
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) return { ok: false, reason: "error", message: "Geen antwoord" };
    const r = JSON.parse(text) as Record<string, unknown>;

    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
    const num = (v: unknown, max: number) => {
      const n = Math.round(Number(v));
      return v != null && Number.isFinite(n) && n > 0 ? Math.min(n, max) : null;
    };
    const cats = ["soep", "hoofdgerecht", "dessert", "gebak-brood"] as const;
    return {
      ok: true,
      recipe: {
        title: String(r.titel ?? "").trim().slice(0, 200),
        category: cats.find((c) => c === r.categorie) ?? "hoofdgerecht",
        servings: num(r.personen, 100),
        prepMinutes: num(r.bereidingstijd_minuten, 10000),
        ingredients: list(r.ingredienten),
        steps: list(r.bereiding),
        notes: String(r.notities ?? "").trim(),
      },
    };
  } catch (e) {
    // "fetch failed" verbergt de echte reden in e.cause (ENOTFOUND = DNS, ETIMEDOUT/ENETUNREACH = geen route, ...).
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? (e as Error).message;
    console.error("Gemini scan mislukt", e);
    return { ok: false, reason: "error", message: `geen verbinding met Google: ${detail}` };
  }
}
