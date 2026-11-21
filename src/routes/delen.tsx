import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CircleAlert, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { importRecipeFromUrl } from "@/lib/import.functions";
import { extractSharedUrl } from "@/lib/recipe-url";

type Search = { url?: string; text?: string; title?: string };
const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 3000) : undefined);

// Doel van de deel-knop van de telefoon (zie `share_target` in manifest.webmanifest) én een plek om zelf een link te plakken.
export const Route = createFileRoute("/delen")({
  validateSearch: (s: Record<string, unknown>): Search => ({ url: str(s.url), text: str(s.text), title: str(s.title) }),
  head: () => ({ meta: [{ title: "Recept toevoegen — Dish" }] }),
  component: Delen,
});

function Delen() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const send = useServerFn(importRecipeFromUrl);
  const [state, setState] = useState<"idle" | "bezig" | "fout">("idle");
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");
  const started = useRef(false);

  const run = useCallback(async (url: string) => {
    setState("bezig");
    setError("");
    let res;
    try {
      res = await send({ data: { url } });
    } catch (e) {
      res = { ok: false as const, message: (e as Error).message || "Verbinding mislukt" };
    }
    if (!res.ok) { setState("fout"); setError(res.message); return; }
    void qc.invalidateQueries({ queryKey: ["recipes"] });
    toast.success(res.duplicate ? `“${res.title}” had je al in je schrift` : `“${res.title}” staat in je schrift, met het label “Te controleren”`);
    void navigate({ to: "/recepten/$id", params: { id: res.id }, replace: true });
  }, [send, qc, navigate]);

  const shared = extractSharedUrl(search);
  useEffect(() => {
    if (shared && !started.current) { started.current = true; void run(shared); }
  }, [shared, run]);

  function submitManual(e: FormEvent) {
    e.preventDefault();
    const url = extractSharedUrl({ text: manual });
    if (!url) { setState("fout"); setError("Dat lijkt geen link te zijn (die begint met https://)"); return; }
    void run(url);
  }

  return (
    <main className="page mx-auto max-w-xl pb-20 pt-8">
      <h1 className="mb-6"><span className="scribble">Recept toevoegen</span></h1>

      {state === "bezig" && (
        <div className="card flex items-center gap-4 p-5" role="status">
          <Loader2 className="h-6 w-6 shrink-0 animate-spin" />
          <div>
            <p className="font-bold">Recept ophalen…</p>
            <p className="break-all text-base text-muted-foreground">{shared ?? manual}</p>
          </div>
        </div>
      )}

      {state === "fout" && (
        <div role="alert" className="wobbly-sm mb-6 flex items-start gap-3 border-2 border-destructive bg-card px-4 py-3 text-destructive">
          <CircleAlert className="mt-1 h-5 w-5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {state !== "bezig" && (
        <form onSubmit={submitManual} className="card space-y-4 p-5">
          <p className="text-muted-foreground">
            {shared ? "Probeer het opnieuw of plak een andere link." : "Plak hier de link van een recept op een website. Dish haalt het recept op en bewaart het als “Te controleren”."}
          </p>
          <div>
            <label className="label" htmlFor="link">Link van het recept</label>
            <input id="link" className="field" value={manual} onChange={(e) => setManual(e.target.value)}
              inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://…" required />
          </div>
          <button type="submit" className="btn-primary w-full"><Link2 className="h-5 w-5" /> Recept ophalen</button>
          <p className="text-center text-sm text-muted-foreground">
            Tip: in de geïnstalleerde Dish-app (Android) staat Dish ook in het deelmenu van je browser.
          </p>
        </form>
      )}

      <div className="mt-6"><Link to="/" className="btn-outline">Naar mijn recepten</Link></div>
    </main>
  );
}
