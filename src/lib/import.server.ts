// Alleen op de server. Leest een bestand (PDF, Word, tekst of afbeelding) met Gemini en bewaart alle gevonden recepten
// met het label "Te controleren". Dubbels (zelfde titel) worden overgeslagen.
import { generateJson, PROMPT, RECIPES_SCHEMA, toScanResult, type GeminiPart } from "./scan.server";
import { mutateRecipes } from "./store.server";
import type { Recipe } from "./recipes";

export type ImportKind = "image" | "pdf" | "docx" | "text";

export type ImportOutcome =
  | { ok: true; added: string[]; duplicates: string[] }
  | { ok: false; reason: "no-key" | "limit" | "busy" | "error"; message: string };

const IMPORT_PROMPT = `${PROMPT}
Extra regels voor dit bestand:
- Het bestand kan één recept bevatten, maar ook meerdere (bv. een document met een heleboel recepten). Geef elk recept als apart item in "recepten".
- Staat er geen enkel recept in, geef dan een lege lijst.
- Neem geen inhoudsopgave, voorwoord of reclame mee als recept.`;

const MAX_TEXT = 120_000;

export const normalizeTitle = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export async function importFile(input: { kind: ImportKind; mime: string; data: string; name: string }): Promise<ImportOutcome> {
  const parts: GeminiPart[] = [];
  if (input.kind === "image" || input.kind === "pdf") {
    parts.push({ inline_data: { mime_type: input.kind === "pdf" ? "application/pdf" : input.mime, data: input.data } });
  } else {
    let text = "";
    if (input.kind === "docx") {
      try {
        const mammoth = await import("mammoth");
        text = (await mammoth.extractRawText({ buffer: Buffer.from(input.data, "base64") })).value;
      } catch (e) {
        console.error("Word-bestand lezen mislukt", e);
        return { ok: false, reason: "error", message: "Dit Word-bestand kon niet gelezen worden" };
      }
    } else {
      text = Buffer.from(input.data, "base64").toString("utf8");
    }
    text = text.trim();
    if (text.length < 20) return { ok: false, reason: "error", message: "Geen tekst gevonden (staat het recept als afbeelding in het document?)" };
    parts.push({ text: `Inhoud van het bestand "${input.name}":\n\n${text.slice(0, MAX_TEXT)}` });
  }
  parts.push({ text: IMPORT_PROMPT });

  const out = await generateJson(parts, RECIPES_SCHEMA);
  if (!out.ok) return { ok: false, reason: out.reason, message: out.message };

  let found: ReturnType<typeof toScanResult>[];
  try {
    const raw = (JSON.parse(out.text) as { recepten?: unknown }).recepten;
    found = (Array.isArray(raw) ? raw : []).slice(0, 40).map((r) => toScanResult(r as Record<string, unknown>));
  } catch {
    return { ok: false, reason: "error", message: "Antwoord van Gemini was onleesbaar" };
  }
  found = found.filter((r) => r.title && (r.ingredients.length || r.steps.length));

  return mutateRecipes((all) => {
    const seen = new Set(all.map((r) => normalizeTitle(r.title)));
    const added: string[] = [];
    const duplicates: string[] = [];
    const now = new Date().toISOString();
    for (const r of found) {
      const key = normalizeTitle(r.title);
      if (seen.has(key)) { duplicates.push(r.title); continue; }
      seen.add(key);
      const recipe: Recipe = {
        id: crypto.randomUUID(),
        title: r.title,
        category: r.category,
        servings: r.servings ?? 4,
        prepMinutes: r.prepMinutes,
        ingredients: r.ingredients,
        steps: r.steps,
        notes: r.notes,
        glutenFree: false, // alleen de gebruiker bevestigt dit
        needsReview: true,
        image: null,
        rating: 0,
        favorite: false,
        createdAt: now,
        updatedAt: now,
      };
      all.push(recipe);
      added.push(r.title);
    }
    return { ok: true as const, added, duplicates };
  });
}
