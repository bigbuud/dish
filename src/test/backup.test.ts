import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { buildBackupZip, recipeToPdf, safeName } from "@/lib/backup.server";
import type { Recipe } from "@/lib/recipes";

const base: Recipe = {
  id: "1",
  title: "Crème brûlée met ⅓ vanille",
  category: "dessert",
  servings: 4,
  prepMinutes: 45,
  ingredients: ["500 ml room", "5 eidooiers", "½ vanillestokje", "suiker: “bruin”"],
  steps: ["Verwarm de oven voor op 150°C.", "Meng alles. ".repeat(60)],
  notes: "Lekker met een bolletje ijs.\nTweede regel.",
  glutenFree: true,
  needsReview: false,
  image: null,
  rating: 4,
  favorite: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("pdf-back-up", () => {
  it("maakt een geldige pdf, ook met accenten, breuken en lange tekst", async () => {
    const bytes = await recipeToPdf(base, "2026-11-15");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("verdeelt zeer lange recepten over meerdere pagina's", async () => {
    const long = { ...base, steps: Array.from({ length: 80 }, (_, i) => `Stap ${i + 1}: ${"tekst ".repeat(30)}`) };
    const pdf = await PDFDocument.load(await recipeToPdf(long, "2026-11-15"));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });

  it("zet in de zip één pdf per recept (per categorie) plus recipes.json, ook bij dubbele titels", async () => {
    const { zip, filename } = await buildBackupZip([base, { ...base, id: "2" }, { ...base, id: "3", title: 'Taart: "bijna" / klaar?', category: "gebak-brood" }]);
    expect(filename).toMatch(/^dish-backup-\d{4}-\d{2}-\d{2}\.zip$/);
    const names = Object.keys(unzipSync(zip)).map((n) => n.split("/").slice(1).join("/"));
    expect(names).toContain("Dessert/Crème brûlée met ⅓ vanille.pdf");
    expect(names).toContain("Dessert/Crème brûlée met ⅓ vanille (2).pdf");
    expect(names).toContain("Gebak & brood/Taart bijna klaar.pdf");
    expect(names).toContain("recipes.json");
  });
});

describe("bestandsnamen", () => {
  it("haalt tekens weg die Windows/OneDrive niet toestaat", () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j')).toBe("abcdefghij");
    expect(safeName("Soep. ")).toBe("Soep");
    expect(safeName("CON")).toBe("recept CON");
    expect(safeName("???")).toBe("recept");
  });
});
