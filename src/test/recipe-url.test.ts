import { describe, expect, it } from "vitest";
import { extractSharedUrl, htmlToText, isoMinutes, parseJsonLdRecipe } from "@/lib/recipe-url";
import { isBlockedAddress } from "@/lib/import-url.server";

describe("gedeelde link", () => {
  it("neemt de url over", () => expect(extractSharedUrl({ url: "https://a.be/r" })).toBe("https://a.be/r"));
  it("vindt de link in de tekst van een deel-actie", () =>
    expect(extractSharedUrl({ text: "Lekkere soep! https://a.be/soep?x=1 groetjes" })).toBe("https://a.be/soep?x=1"));
  it("strip leestekens achter de link", () => expect(extractSharedUrl({ text: "kijk (https://a.be/r)." })).toBe("https://a.be/r"));
  it("geeft null zonder link", () => expect(extractSharedUrl({ title: "geen link hier" })).toBeNull());
});

describe("schema.org-recept", () => {
  const page = (ld: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head></html>`;
  const recipe = {
    "@type": "Recipe",
    name: "Tomatensoep &amp; basilicum",
    recipeYield: ["4", "4 personen"],
    totalTime: "PT1H15M",
    recipeCategory: "Soep",
    recipeIngredient: ["500 g tomaten", "1 ui"],
    recipeInstructions: [
      { "@type": "HowToSection", itemListElement: [{ "@type": "HowToStep", text: "Snipper de ui." }] },
      { "@type": "HowToStep", text: "Laat <b>sudderen</b>." },
    ],
  };

  it("leest een recept in een @graph", () => {
    const r = parseJsonLdRecipe(page({ "@graph": [{ "@type": "WebPage" }, recipe] }));
    expect(r).toMatchObject({ title: "Tomatensoep & basilicum", category: "soep", servings: 4, prepMinutes: 75 });
    expect(r?.ingredients).toEqual(["500 g tomaten", "1 ui"]);
    expect(r?.steps).toEqual(["Snipper de ui.", "Laat sudderen."]);
  });
  it("geeft null zonder recept", () => expect(parseJsonLdRecipe(page({ "@type": "Article" }))).toBeNull());
  it("negeert kapotte JSON-LD", () => expect(parseJsonLdRecipe(`<script type="application/ld+json">{oeps</script>`)).toBeNull());
  it("zet ISO-duren om", () => { expect(isoMinutes("PT45M")).toBe(45); expect(isoMinutes("")).toBeNull(); });
});

describe("paginatekst", () => {
  it("laat scripts en menu's weg", () => {
    const t = htmlToText("<title>Soep</title><nav>Menu</nav><script>x()</script><p>500 g tomaten</p><p>Snipper&nbsp;de ui</p>");
    expect(t).toContain("500 g tomaten");
    expect(t).toContain("Snipper de ui");
    expect(t).not.toContain("Menu");
    expect(t).not.toContain("x()");
  });
});

describe("geblokkeerde adressen (SSRF)", () => {
  it.each(["127.0.0.1", "10.0.0.5", "192.168.1.201", "172.16.0.1", "169.254.169.254", "100.100.1.1", "::1", "fd00::1", "::ffff:192.168.1.1"])(
    "blokkeert %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])("laat %s door", (ip) => expect(isBlockedAddress(ip)).toBe(false));
});
