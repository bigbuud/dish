import { categoryLabel, type Recipe } from "./recipes";

/** Zet een recept om naar gewone tekst voor WhatsApp, mail, klembord, ... */
export function recipeToText(r: Recipe, ingredients: string[], servings: number): string {
  const meta = [categoryLabel(r.category), r.glutenFree ? "glutenvrij" : null, `${servings} ${servings === 1 ? "persoon" : "personen"}`, r.prepMinutes ? `${r.prepMinutes} min` : null]
    .filter(Boolean)
    .join(" · ");
  const parts = [r.title, meta, "", "Ingrediënten", ...ingredients.map((i) => `- ${i}`)];
  if (r.steps.length) parts.push("", "Bereiding", ...r.steps.map((s, n) => `${n + 1}. ${s}`));
  if (r.notes.trim()) parts.push("", "Notities", r.notes.trim());
  parts.push("", "— Gedeeld vanuit Dish");
  return parts.join("\n");
}
