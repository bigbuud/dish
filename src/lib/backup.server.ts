import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { zipSync } from "fflate";
import patrickHandUrl from "@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff?inline";
import { categoryLabel, type Recipe } from "./recipes";

// ---- pagina-indeling (A4, "lijntjesschrift") -------------------------------------------------
const W = 595.28;
const H = 841.89;
const LH = 22; // regelhoogte = afstand tussen de lijntjes
const TOP = H - 56; // eerste lijntje
const BOTTOM = 60;
const LEFT = 62;
const RIGHT = W - 44;
const INK = rgb(0.13, 0.13, 0.15);
const MUTED = rgb(0.4, 0.4, 0.45);
const RULE = rgb(0.78, 0.86, 0.95);
const MARGIN_LINE = rgb(0.9, 0.55, 0.55);

const REPLACE: Record<string, string> = {
  "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8", "⅕": "1/5",
  "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "•": "-", "·": "-",
  " ": " ", " ": " ", "\t": " ",
};

function dataUrlBytes(url: string): { mime: string; bytes: Uint8Array } | null {
  const m = url.match(/^data:([^;,]+);base64,(.*)$/s);
  return m ? { mime: m[1], bytes: new Uint8Array(Buffer.from(m[2], "base64")) } : null;
}

async function loadFont(doc: PDFDocument): Promise<PDFFont> {
  const font = dataUrlBytes(patrickHandUrl);
  if (!font) throw new Error("Lettertype kon niet geladen worden");
  doc.registerFontkit(fontkit);
  return doc.embedFont(font.bytes, { subset: true });
}

export async function recipeToPdf(r: Recipe, backupDate: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(r.title);
  doc.setProducer("Dish");
  doc.setCreator("Dish");
  const font = await loadFont(doc);
  const supported = new Set(font.getCharacterSet());

  const clean = (s: string) =>
    Array.from(s.normalize("NFC"))
      .map((ch) => REPLACE[ch] ?? ch)
      .join("")
      .replace(/\r?\n/g, " ")
      .split("")
      .map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : "?"))
      .join("");

  let page!: PDFPage;
  let y = 0;
  const pages: PDFPage[] = [];

  function newPage() {
    page = doc.addPage([W, H]);
    pages.push(page);
    for (let ly = TOP; ly > 40; ly -= LH) {
      page.drawLine({ start: { x: 28, y: ly }, end: { x: W - 28, y: ly }, thickness: 0.6, color: RULE });
    }
    page.drawLine({ start: { x: 50, y: H - 20 }, end: { x: 50, y: 20 }, thickness: 0.9, color: MARGIN_LINE });
    y = TOP;
  }
  newPage();

  /** Schrijf één regel op het volgende lijntje. */
  function line(text: string, opts: { x?: number; size?: number; color?: ReturnType<typeof rgb> } = {}) {
    if (y - LH < BOTTOM) newPage();
    y -= LH;
    page.drawText(text, { x: opts.x ?? LEFT, y: y + 5, size: opts.size ?? 14, font, color: opts.color ?? INK });
  }

  function wrap(text: string, size: number, maxWidth: number): string[] {
    const out: string[] = [];
    let cur = "";
    for (const word of clean(text).split(/ +/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) cur = next;
      else {
        if (cur) out.push(cur);
        // één extreem lang woord: hard afbreken
        let w = word;
        while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
          let n = w.length - 1;
          while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxWidth) n--;
          out.push(w.slice(0, n));
          w = w.slice(n);
        }
        cur = w;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  /** Tekst met hangende inspringing (voor opsommingen en genummerde stappen). */
  function item(marker: string, text: string, size = 14) {
    const indent = 22;
    const lines = wrap(text, size, RIGHT - LEFT - indent);
    (lines.length ? lines : [""]).forEach((l, i) => {
      if (y - LH < BOTTOM) newPage();
      y -= LH;
      if (i === 0) page.drawText(clean(marker), { x: LEFT, y: y + 5, size, font, color: INK });
      page.drawText(l, { x: LEFT + indent, y: y + 5, size, font, color: INK });
    });
  }

  function heading(text: string) {
    if (y - LH * 3 < BOTTOM) newPage();
    y -= LH;
    page.drawText(clean(text), { x: LEFT, y: y + 5, size: 20, font, color: INK });
    page.drawLine({ start: { x: LEFT, y: y + 2 }, end: { x: LEFT + font.widthOfTextAtSize(clean(text), 20), y: y + 2 }, thickness: 1.5, color: rgb(0.95, 0.75, 0.2) });
  }

  // ---- titel ----
  const titleLines = wrap(r.title, 30, RIGHT - LEFT);
  titleLines.forEach((t) => {
    if (y - LH * 2 < BOTTOM) newPage();
    y -= LH * 1.5;
    page.drawText(t, { x: LEFT, y: y + 6, size: 30, font, color: INK });
    y -= LH * 0.5;
  });

  // ---- meta ----
  const meta = [
    categoryLabel(r.category),
    r.glutenFree ? "glutenvrij" : null,
    `${r.servings} ${r.servings === 1 ? "persoon" : "personen"}`,
    r.prepMinutes ? `${r.prepMinutes} min` : null,
    r.rating > 0 ? `beoordeling ${r.rating}/5` : null,
    r.favorite ? "favoriet" : null,
  ].filter(Boolean) as string[];
  line(clean(meta.join("  |  ")), { size: 13, color: MUTED });

  // ---- foto ----
  if (r.image) {
    try {
      const img = dataUrlBytes(r.image);
      if (img) {
        const emb = /png/.test(img.mime) ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
        const maxW = RIGHT - LEFT;
        const maxH = LH * 10;
        const s = Math.min(maxW / emb.width, maxH / emb.height, 1);
        const w = emb.width * s;
        const h = emb.height * s;
        const rows = Math.ceil(h / LH);
        if (y - rows * LH < BOTTOM) newPage();
        y -= LH * 0.5;
        page.drawImage(emb, { x: LEFT, y: y - h, width: w, height: h });
        page.drawRectangle({ x: LEFT, y: y - h, width: w, height: h, borderColor: INK, borderWidth: 1.2 });
        y -= rows * LH;
      }
    } catch {
      // onbekend beeldformaat (bv. webp): recept zonder foto in de pdf, de tekst is wat telt
    }
  }

  // ---- ingrediënten ----
  heading("Ingrediënten");
  if (r.ingredients.length === 0) line("-", { color: MUTED });
  r.ingredients.forEach((i) => item("-", i));

  // ---- bereiding ----
  if (r.steps.length) {
    y -= LH * 0.5;
    heading("Bereiding");
    r.steps.forEach((s, n) => item(`${n + 1}.`, s));
  }

  // ---- notities ----
  if (r.notes.trim()) {
    y -= LH * 0.5;
    heading("Notities");
    r.notes
      .trim()
      .split(/\r?\n/)
      .forEach((para) => {
        const lines = wrap(para, 14, RIGHT - LEFT);
        if (!lines.length) y -= LH;
        lines.forEach((l) => line(l));
      });
  }

  // ---- voettekst ----
  pages.forEach((p, i) => {
    const text = `Dish - back-up ${backupDate}  |  ${i + 1}/${pages.length}`;
    p.drawText(text, { x: RIGHT - font.widthOfTextAtSize(text, 10), y: 26, size: 10, font, color: MUTED });
  });

  return doc.save();
}

// ---- bestandsnamen -----------------------------------------------------------------------------
/** Veilige bestandsnaam voor Windows/OneDrive (geen \ / : * ? " < > |, geen punt of spatie op het einde). */
export function safeName(name: string, max = 80): string {
  let s = name
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/g, "");
  if (!s || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `recept ${s}`.trim();
  return s || "recept";
}

export function today(): string {
  return new Date().toLocaleDateString("sv-SE"); // jjjj-mm-dd
}

/** ZIP met één pdf per recept (per categorie in een map) plus recipes.json als volledige data-back-up. */
export async function buildBackupZip(recipes: Recipe[]): Promise<{ zip: Uint8Array; filename: string; failed: string[] }> {
  const date = today();
  const root = `Dish back-up ${date}`;
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  const failed: string[] = [];

  for (const r of recipes) {
    const dir = safeName(categoryLabel(r.category));
    const base = safeName(r.title);
    let name = `${root}/${dir}/${base}.pdf`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${root}/${dir}/${base} (${n}).pdf`;
    used.add(name.toLowerCase());
    try {
      files[name] = await recipeToPdf(r, date);
    } catch (e) {
      console.error(`Back-up: pdf voor "${r.title}" mislukt`, e);
      failed.push(r.title);
    }
  }

  // Exact hetzelfde formaat als data/recipes.json: kan 1-op-1 teruggezet worden.
  files[`${root}/recipes.json`] = new TextEncoder().encode(JSON.stringify(recipes));
  if (failed.length) files[`${root}/MISLUKT.txt`] = new TextEncoder().encode(`Geen pdf gemaakt voor:\n${failed.join("\n")}\n`);

  // pdf-bestanden zijn al gecomprimeerd; een laag niveau houdt het snel en de json blijft toch klein.
  const zip = zipSync(files, { level: 1 });
  return { zip, filename: `dish-backup-${date}.zip`, failed };
}
