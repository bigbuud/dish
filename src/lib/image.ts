function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
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
  // Nooit opschalen en maximaal ~2000 px: groter kost op een telefoon te veel geheugen (tesseract draait in WebAssembly).
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
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
  const integral = new Uint32Array((w + 1) * (h + 1));
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

/** Leest een foto in op een canvas, rechtgezet volgens de EXIF-stand van de camera en maximaal `max` px lang. */
export async function decodePhoto(file: File, max = 2000): Promise<HTMLCanvasElement> {
  let src: ImageBitmap | HTMLImageElement;
  try {
    src = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    src = await loadImage(file); // moderne browsers passen de EXIF-stand hier ook zelf toe
  }
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * scale));
  c.height = Math.max(1, Math.round(src.height * scale));
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  if ("close" in src) src.close();
  return c;
}

/** Draait een canvas een kwartslag. */
export function rotateCanvas(src: HTMLCanvasElement, clockwise: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.height;
  c.height = src.width;
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((clockwise ? 1 : -1) * Math.PI / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export type CropRect = { x: number; y: number; w: number; h: number }; // fracties van de afbeelding (0..1)

/** Snijdt bij en past helderheid/contrast toe (-50..50 / -50..100, zoals de sliders); levert een JPEG-bestand. */
export function exportEdited(src: HTMLCanvasElement, crop: CropRect, brightness: number, contrast: number): Promise<File> {
  const sx = Math.round(crop.x * src.width), sy = Math.round(crop.y * src.height);
  const sw = Math.max(1, Math.round(crop.w * src.width)), sh = Math.max(1, Math.round(crop.h * src.height));
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  if (brightness !== 0 || contrast !== 0) {
    const b = 1 + brightness / 100, k = 1 + contrast / 100;
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = (v * b - 128) * k + 128; // zelfde volgorde als CSS brightness() contrast()
    const d = ctx.getImageData(0, 0, sw, sh);
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = lut[d.data[i]];
      d.data[i + 1] = lut[d.data[i + 1]];
      d.data[i + 2] = lut[d.data[i + 2]];
    }
    ctx.putImageData(d, 0, 0);
  }
  return new Promise((resolve, reject) =>
    c.toBlob((blob) => (blob ? resolve(new File([blob], "scan.jpg", { type: "image/jpeg" })) : reject(new Error("Foto kon niet worden bewerkt"))), "image/jpeg", 0.92),
  );
}
