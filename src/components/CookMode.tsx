import { useEffect, useRef, useState, type TouchEvent } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Recipe } from "@/lib/recipes";

/** Fullscreen step-by-step view that keeps the screen awake. */
export function CookMode({ recipe, ingredients, onClose }: { recipe: Recipe; ingredients: string[]; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [awake, setAwake] = useState(false);
  const total = recipe.steps.length;
  const touch = useRef<{ x: number; y: number } | null>(null);

  const next = () => setStep((s) => Math.min(total, s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));

  // Vegen: naar links = volgende stap, naar rechts = vorige. Verticaal scrollen blijft werken.
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    const t = e.changedTouches[0];
    touch.current = null;
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) next();
    else prev();
  };

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock?.request("screen");
        setAwake(!!lock);
      } catch { setAwake(false); }
    };
    const onVis = () => document.visibilityState === "visible" && acquire();
    acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); lock?.release(); };
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setStep((s) => Math.min(total, s + 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [total, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)]">
      <header className="flex items-center justify-between border-b-2 border-foreground px-5 py-3">
        <div>
          <p className="font-display text-xl font-bold text-destructive">Kookmodus {awake && "· scherm blijft aan"}</p>
          <h2 className="text-3xl">{recipe.title}</h2>
        </div>
        <button className="btn-ghost h-10 w-10 p-0" onClick={onClose} aria-label="Sluiten"><X className="h-5 w-5" /></button>
      </header>
      <main className="flex flex-1 touch-pan-y items-center justify-center overflow-auto p-6" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="max-w-3xl">
          {step === 0 ? (
            <>
              <h2 className="mb-4"><span className="scribble">Klaarzetten</span></h2>
              <ul className="grid gap-x-8 gap-y-2 text-xl sm:grid-cols-2">
                {ingredients.map((i, n) => <li key={n} className="border-b border-border py-1">{i}</li>)}
              </ul>
            </>
          ) : (
            <>
              <p className="mb-4 font-display text-8xl font-bold text-destructive">{step}<span className="text-4xl text-muted-foreground">/{total}</span></p>
              <p className="text-3xl leading-relaxed sm:text-4xl">{recipe.steps[step - 1]}</p>
            </>
          )}
        </div>
      </main>
      <footer className="flex items-center justify-between gap-3 border-t-2 border-foreground p-4">
        <button className="btn-outline px-6 py-3 text-base" disabled={step === 0} onClick={prev}><ChevronLeft className="h-5 w-5" /> Vorige</button>
        <div className="flex gap-1">{Array.from({ length: total + 1 }, (_, i) => <span key={i} className={`h-2 w-5 rounded-full ${i <= step ? "bg-foreground" : "bg-border"}`} />)}</div>
        {step < total ? (
          <button className="btn-primary px-6 py-3 text-base" onClick={next}>Volgende <ChevronRight className="h-5 w-5" /></button>
        ) : (
          <button className="btn-primary px-6 py-3 text-base" onClick={onClose}>Smakelijk!</button>
        )}
      </footer>
    </div>
  );
}
