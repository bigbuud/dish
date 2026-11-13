import { describe, expect, it } from "vitest";
import { parseRecipeText, scaleIngredient } from "@/lib/recipes";

describe("porties omrekenen", () => {
  it("verdubbelt grammen", () => expect(scaleIngredient("200 g bloem", 2)).toBe("400 g bloem"));
  it("rekent breuken om", () => expect(scaleIngredient("1/2 ui", 2)).toBe("1 ui"));
  it("werkt met komma-getallen", () => expect(scaleIngredient("1,5 dl melk", 2)).toBe("3 dl melk"));
  it("halveert naar decimalen", () => expect(scaleIngredient("3 eieren", 0.5)).toBe("1,5 eieren"));
  it("laat regels zonder hoeveelheid ongemoeid", () => expect(scaleIngredient("zout en peper", 3)).toBe("zout en peper"));
});

describe("gescande tekst", () => {
  it("herkent titel, personen, ingrediënten en stappen", () => {
    const r = parseRecipeText("Tomatensoep\n4 personen\nIngrediënten\n500 g tomaten\n1 ui\nBereiding\n1. Snipper de ui.\n2. Voeg tomaten toe.");
    expect(r.title).toBe("Tomatensoep");
    expect(r.servings).toBe(4);
    expect(r.ingredients).toEqual(["500 g tomaten", "1 ui"]);
    expect(r.steps).toEqual(["Snipper de ui.", "Voeg tomaten toe."]);
  });
});
