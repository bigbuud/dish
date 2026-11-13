import { z } from "zod";

export const CATEGORIES = [
  { id: "soep", label: "Soep" },
  { id: "hoofdgerecht", label: "Hoofdgerecht" },
  { id: "dessert", label: "Dessert" },
  { id: "gebak-brood", label: "Gebak & brood" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const categoryLabel = (id: string) =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;

export const recipeInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1, "Geef een titel").max(200),
  category: z.enum(["soep", "hoofdgerecht", "dessert", "gebak-brood"]),
  servings: z.number().int().min(1).max(100),
  prepMinutes: z.number().int().min(0).max(10000).nullable(),
  ingredients: z.array(z.string().trim().min(1).max(500)).max(200),
  steps: z.array(z.string().trim().min(1).max(5000)).max(200),
  notes: z.string().max(10000),
  image: z.string().max(8_000_000).nullable(),
});

export type RecipeInput = z.infer<typeof recipeInputSchema>;

export interface Recipe extends Omit<RecipeInput, "id"> {
  id: string;
  rating: number;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

function parseAmount(raw: string): number {
  const s = raw.trim();
  let total = 0;
  for (const part of s.split(/\s+/)) {
    const m = part.match(/^(\d+)?([½¼¾⅓⅔])$/);
    if (m) total += (m[1] ? Number(m[1]) : 0) + FRACTIONS[m[2]];
    else if (part.includes("/")) {
      const [a, b] = part.split("/").map(Number);
      total += a / b;
    } else total += Number(part.replace(",", "."));
  }
  return total;
}

export function formatAmount(n: number): string {
  const rounded = n >= 10 ? Math.round(n) : Math.round(n * 100) / 100;
  return rounded.toLocaleString("nl-BE", { maximumFractionDigits: 2 });
}

const AMOUNT_RE = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d*[½¼¾⅓⅔]|\d+(?:[.,]\d+)?)(?=\s|[a-zA-Z]|$)/;

/** Multiply the leading quantity of an ingredient line by factor. */
export function scaleIngredient(line: string, factor: number): string {
  if (factor === 1) return line;
  const lead = line.match(/^\s*/)?.[0] ?? "";
  const rest = line.slice(lead.length);
  const m = rest.match(AMOUNT_RE);
  if (!m) return line;
  const value = parseAmount(m[1]);
  if (!Number.isFinite(value)) return line;
  return lead + formatAmount(value * factor) + rest.slice(m[1].length);
}

const ING_HEADER = /^(ingredi[eë]nten|benodigdheden|nodig)\b/i;
const STEP_HEADER = /^(bereiding|werkwijze|instructies|bereidingswijze|aanpak)\b/i;
const SERVINGS_RE = /(\d+)\s*(personen|pers\.?|porties|stuks)/i;

/** Turn scanned (OCR) text into a draft recipe. */
export function parseRecipeText(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let title = "";
  let servings: number | null = null;
  const ingredients: string[] = [];
  const steps: string[] = [];
  let mode: "none" | "ing" | "step" = "none";

  for (const line of lines) {
    const s = line.match(SERVINGS_RE);
    if (s && servings === null && line.length < 40) {
      servings = Number(s[1]);
      continue;
    }
    if (ING_HEADER.test(line)) { mode = "ing"; continue; }
    if (STEP_HEADER.test(line)) { mode = "step"; continue; }
    if (!title) { title = line; continue; }
    const clean = line.replace(/^[-•*·]\s*/, "");
    if (mode === "ing") ingredients.push(clean);
    else if (mode === "step") pushStep(steps, line);
    else if (AMOUNT_RE.test(clean) || /^[-•*·]/.test(line)) ingredients.push(clean);
    else pushStep(steps, line);
  }
  return { title, servings, ingredients, steps };
}

function pushStep(steps: string[], line: string) {
  const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
  if (numbered) steps.push(numbered[2]);
  else if (steps.length && !/[.!?:]$/.test(steps[steps.length - 1])) steps[steps.length - 1] += " " + line;
  else steps.push(line);
}
