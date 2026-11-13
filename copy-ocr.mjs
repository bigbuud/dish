// Kopieert de OCR-bestanden (tesseract worker, core en Nederlandse taaldata) uit node_modules
// naar public/tesseract, zodat scannen volledig lokaal werkt — zonder CDN of internet.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const out = join(process.cwd(), "public", "tesseract");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "core"), { recursive: true });
mkdirSync(join(out, "lang"), { recursive: true });

cpSync(join(pkgDir("tesseract.js"), "dist", "worker.min.js"), join(out, "worker.min.js"));

const coreDir = pkgDir("tesseract.js-core");
for (const f of readdirSync(coreDir)) {
  if (f.endsWith("-lstm.wasm.js")) cpSync(join(coreDir, f), join(out, "core", f));
}

cpSync(
  join(pkgDir("@tesseract.js-data/nld"), "4.0.0_best_int", "nld.traineddata.gz"),
  join(out, "lang", "nld.traineddata.gz"),
);
console.log("OCR-bestanden gekopieerd naar public/tesseract");
