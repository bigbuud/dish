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
    const call = (model: string, thinking: boolean) => fetch(API(model), {
      method: "POST",
      signal: AbortSignal.timeout(40_000),
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: m[1], data: m[2] } }, { text: PROMPT }] }],
        generationConfig: {
          temperature: 0.1,
          // Lezen hoeft niet lang "na te denken": scheelt veel wachttijd. Sommige modellen kennen dit veld niet; dan proberen we zonder.
          ...(thinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
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
      return { ok: false, reason: "error", message };
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
