function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Resize a photo to a compact JPEG data URL for storage. */
export async function compressImage(file: File, max = 1400): Promise<string> {
  const img = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}

/**
 * Voorbewerking voor tesseract: grijswaarden + lokale drempel (Bradley), zodat schaduwen en ongelijk licht
 * op een foto van een pagina geen tekst opeten. Resultaat is zwarte tekst op wit.
 */
export async function scanEnhance(file: File): Promise<HTMLCanvasElement> {
  const img = await loadImage(file);
  const scale = Math.min(2, 2800 / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  const p = d.data;

  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) gray[j] = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];

  // Integraalbeeld voor snelle lokale gemiddelden.
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(15, Math.round(Math.min(w, h) / 24));
  const t = 0.88; // pixel is "inkt" als hij >12% donkerder is dan zijn omgeving
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = gray[y * w + x] < mean * t ? 0 : 255;
      const i = (y * w + x) * 4;
      p[i] = p[i + 1] = p[i + 2] = v;
    }
  }
  ctx.putImageData(d, 0, 0);
  return c;
}
