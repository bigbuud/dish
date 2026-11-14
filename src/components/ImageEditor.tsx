import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Loader2, RotateCcw, RotateCw, ScanText } from "lucide-react";
import { toast } from "sonner";
import { decodePhoto, exportEdited, rotateCanvas, type CropRect } from "@/lib/image";

const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.08; // kleinste uitsnede (fractie)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Mode = "move" | "nw" | "ne" | "sw" | "se";
const CORNERS: { mode: Mode; cls: string }[] = [
  { mode: "nw", cls: "left-0 top-0 cursor-nwse-resize border-l-4 border-t-4" },
  { mode: "ne", cls: "right-0 top-0 cursor-nesw-resize border-r-4 border-t-4" },
  { mode: "sw", cls: "bottom-0 left-0 cursor-nesw-resize border-b-4 border-l-4" },
  { mode: "se", cls: "bottom-0 right-0 cursor-nwse-resize border-b-4 border-r-4" },
];

/** Volscherm-bewerker vóór het scannen: rechtzetten, bijsnijden, helderheid en contrast. */
export function ImageEditor({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (edited: File) => void }) {
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  const [crop, setCrop] = useState<CropRect>(FULL);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [busy, setBusy] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Mode; sx: number; sy: number; start: CropRect } | null>(null);

  useEffect(() => {
    let alive = true;
    decodePhoto(file).then(
      (c) => alive && setBase(c),
      () => { toast.error("Die foto kon niet worden geopend (probeer JPG of PNG)"); onCancel(); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => {
    const p = preview.current;
    if (!base || !p) return;
    p.width = base.width;
    p.height = base.height;
    p.getContext("2d")!.drawImage(base, 0, 0);
  }, [base]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function rotate(clockwise: boolean) {
    if (!base) return;
    setBase(rotateCanvas(base, clockwise));
    setCrop(FULL);
  }

  function begin(mode: Mode, e: RPointerEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: crop };
  }
  function move(e: RPointerEvent<HTMLElement>) {
    const d = drag.current, el = box.current;
    if (!d || !el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - d.sx) / r.width, dy = (e.clientY - d.sy) / r.height;
    const s = d.start;
    if (d.mode === "move") {
      setCrop({ ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) });
      return;
    }
    let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
    if (d.mode.includes("w")) x0 = clamp(s.x + dx, 0, x1 - MIN); else x1 = clamp(x1 + dx, x0 + MIN, 1);
    if (d.mode.includes("n")) y0 = clamp(s.y + dy, 0, y1 - MIN); else y1 = clamp(y1 + dy, y0 + MIN, 1);
    setCrop({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  const end = () => { drag.current = null; };

  async function confirm() {
    if (!base) return;
    setBusy(true);
    try {
      onDone(await exportEdited(base, crop, brightness, contrast));
    } catch (e) {
      console.error(e);
      toast.error("Foto bewerken mislukt");
      setBusy(false);
    }
  }

  const ratio = base ? base.width / base.height : 1;
  const changed = brightness !== 0 || contrast !== 0 || crop !== FULL;

  return (
    <div role="dialog" aria-modal="true" aria-label="Foto bewerken" className="fixed inset-0 z-50 overflow-y-auto bg-foreground/60 p-3 sm:p-6">
      <div className="card mx-auto max-w-2xl overflow-hidden">
        <div className="hero-band border-b-2 border-foreground px-5 py-3">
          <h2>Foto bewerken</h2>
          <p className="mt-1 text-base">Zet de foto rechtop en sleep de hoeken tot alleen het recept overblijft. Dat leest veel beter.</p>
        </div>

        <div className="space-y-4 p-4">
          {!base ? (
            <div className="flex h-48 items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div
              ref={box}
              className="relative mx-auto select-none overflow-hidden border-2 border-foreground bg-muted"
              style={{ aspectRatio: String(ratio), width: `min(100%, ${(58 * ratio).toFixed(2)}vh)` }}
            >
              <canvas
                ref={preview}
                className="block h-full w-full"
                style={{ filter: `brightness(${1 + brightness / 100}) contrast(${1 + contrast / 100})` }}
              />
              <div
                className="absolute cursor-move touch-none border-2 border-dashed border-white"
                style={{
                  left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%`,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                }}
                onPointerDown={(e) => begin("move", e)}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
              >
                {CORNERS.map((c) => (
                  <div
                    key={c.mode}
                    className={`absolute h-9 w-9 touch-none border-white ${c.cls}`}
                    onPointerDown={(e) => begin(c.mode, e)}
                    onPointerMove={move}
                    onPointerUp={end}
                    onPointerCancel={end}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-outline" disabled={!base || busy} onClick={() => rotate(false)}><RotateCcw className="h-5 w-5" /> Links draaien</button>
            <button type="button" className="btn-outline" disabled={!base || busy} onClick={() => rotate(true)}><RotateCw className="h-5 w-5" /> Rechts draaien</button>
            <button type="button" className="btn-ghost" disabled={!base || busy || !changed} onClick={() => { setCrop(FULL); setBrightness(0); setContrast(0); }}>Herstel</button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Helderheid</span>
              <input type="range" min={-50} max={50} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="w-full accent-primary" />
            </label>
            <label className="block">
              <span className="label">Contrast</span>
              <input type="range" min={-50} max={100} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="w-full accent-primary" />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t-2 border-foreground p-4">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>Annuleren</button>
          <button type="button" className="btn-primary px-6" disabled={!base || busy} onClick={confirm}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ScanText className="h-5 w-5" />} Scannen
          </button>
        </div>
      </div>
    </div>
  );
}
