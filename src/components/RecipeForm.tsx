import { useRef, useState, type DragEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, ImagePlus, Loader2, Pencil, ScanText, X } from "lucide-react";
import { toast } from "sonner";
import { CATEGORIES, parseRecipeText, type CategoryId, type Recipe } from "@/lib/recipes";
import { saveRecipe } from "@/lib/recipes.functions";
import { scanRecipeImage } from "@/lib/scan.functions";
import { compressImage, scanEnhance } from "@/lib/image";
import { ImageEditor } from "@/components/ImageEditor";

/** Maakt een element geschikt om een afbeelding op te slepen (pc). */
function useImageDrop(onFile: (file: File) => void) {
  const [over, setOver] = useState(false);
  const props = {
    onDragEnter: (e: DragEvent) => { e.preventDefault(); setOver(true); },
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) return toast.error("Dat is geen afbeelding");
      onFile(file);
    },
  };
  return { over, props };
}

export function RecipeForm({ recipe, allowScan }: { recipe?: Recipe; allowScan?: boolean }) {
  const [title, setTitle] = useState(recipe?.title ?? "");
  const [category, setCategory] = useState<CategoryId>(recipe?.category ?? "hoofdgerecht");
  // Tekst-state: zo kan je het veld leegmaken en een nieuw getal typen (anders blijft er een "1" staan).
  const [servings, setServings] = useState(String(recipe?.servings ?? 4));
  const [prep, setPrep] = useState(recipe?.prepMinutes?.toString() ?? "");
  const [ingredients, setIngredients] = useState(recipe?.ingredients.join("\n") ?? "");
  const [steps, setSteps] = useState(recipe?.steps.join("\n") ?? "");
  const [notes, setNotes] = useState(recipe?.notes ?? "");
  const [image, setImage] = useState<string | null>(recipe?.image ?? null);
  const [scanning, setScanning] = useState<number | null>(null);
  const [scanMode, setScanMode] = useState<"ai" | "ocr">("ai");
  const [scanText, setScanText] = useState<string | null>(null);
  // Gekozen foto wacht eerst in de bewerker (draaien/bijsnijden); `lastScan` is het origineel van de laatste scan, voor "opnieuw bewerken".
  const [editing, setEditing] = useState<File | null>(null);
  const [lastScan, setLastScan] = useState<File | null>(null);
  const scanCam = useRef<HTMLInputElement>(null);
  const scanFile = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const photoCam = useRef<HTMLInputElement>(null);

  async function setPhoto(file?: File) {
    if (!file) return;
    try {
      setImage(await compressImage(file));
    } catch {
      toast.error("Die foto kon niet worden geopend (probeer JPG of PNG)");
    }
  }
  const photoDrop = useImageDrop(setPhoto);
  const scanDrop = useImageDrop((f) => pickScan(f));

  const navigate = useNavigate();
  const qc = useQueryClient();
  const save = useServerFn(saveRecipe);
  const scanAI = useServerFn(scanRecipeImage);
  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: recipe?.id, title, category, servings: Math.min(100, Math.max(1, Math.round(Number(servings)) || 1)),
          prepMinutes: prep ? Number(prep) : null,
          ingredients: ingredients.split("\n").map((l) => l.trim()).filter(Boolean),
          steps: steps.split("\n").map((l) => l.trim()).filter(Boolean),
          notes, image,
        },
      }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["recipes"] });
      toast.success("Recept bewaard");
      navigate({ to: "/recepten/$id", params: { id: r.id } });
    },
    onError: (e) => toast.error(`Bewaren mislukt: ${e.message}`),
  });

  function pickScan(file?: File) {
    if (file) setEditing(file);
  }

  async function runScan(file: File) {
    setScanning(0);
    setScanText(null);
    try {
      // 1) Slimme scan via Gemini: leest ook handschrift en geeft meteen een net recept terug.
      let aiFailed = false;
      let aiError = "";
      try {
        setScanMode("ai");
        const res = await scanAI({ data: { image: await compressImage(file, 2000) } });
        if (res.ok) {
          const r = res.recipe;
          if (r.title) setTitle(r.title);
          setCategory(r.category);
          if (r.servings) setServings(String(r.servings));
          if (r.prepMinutes) setPrep(String(r.prepMinutes));
          setIngredients(r.ingredients.join("\n"));
          setSteps(r.steps.join("\n"));
          if (r.notes) setNotes(r.notes);
          toast.success("Recept gelezen — controleer vooral woorden met [?]");
          return;
        }
        if (res.reason === "no-key") toast.message("Geen Gemini-sleutel ingesteld — gewone tekstherkenning gebruikt");
        aiFailed = res.reason === "error";
        if (!res.ok) aiError = res.message ?? "";
      } catch (e) {
        console.error(e);
        aiFailed = true;
        aiError = (e as Error)?.message ?? "";
      }
      if (aiFailed) toast.message(`Slimme scan mislukt${aiError ? ` (${aiError})` : ""} — gewone tekstherkenning gebruikt`, { duration: 12000 });

      // 2) Terugval: lokale OCR (tesseract), werkt offline maar leest geen handschrift.
      setScanMode("ocr");
      setScanning(0);
      const canvas = await scanEnhance(file);
      const { createWorker } = await import("tesseract.js");
      // Alles wordt door de eigen server geleverd (zie scripts/copy-ocr.mjs): scannen werkt zonder internet.
      const worker = await createWorker("nld", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/core",
        langPath: "/tesseract/lang",
        logger: (m) => m.status === "recognizing text" && setScanning(Math.round(m.progress * 100)),
      });
      const { data } = await worker.recognize(canvas);
      await worker.terminate();
      const parsed = parseRecipeText(data.text);
      setScanText(data.text);
      if (parsed.title) setTitle(parsed.title);
      if (parsed.servings) setServings(String(parsed.servings));
      if (parsed.ingredients.length) setIngredients(parsed.ingredients.join("\n"));
      if (parsed.steps.length) setSteps(parsed.steps.join("\n"));
      toast.success("Tekst herkend — controleer en verbeter waar nodig");
    } catch (e) {
      toast.error("Scannen mislukt. Probeer een scherpere foto.");
      console.error(e);
      if (/memory|allocation|abort/i.test(String((e as Error)?.message ?? e))) {
        toast.error("Te weinig geheugen voor de gewone scan. Stel een Gemini-sleutel in of probeer een kleinere foto.");
      }
    } finally {
      setScanning(null);
    }
  }

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return toast.error("Geef een titel"); mutation.mutate(); }}
    >
      {allowScan && (
        <section {...scanDrop.props} className={`card overflow-hidden transition ${scanDrop.over ? "bg-accent/40 outline-dashed outline-4 outline-offset-2 outline-foreground" : ""}`}>
          <div className="hero-band border-b-2 border-foreground px-6 py-4">
            <h2 className="flex items-center gap-2"><ScanText className="h-7 w-7" /> Scan een recept</h2>
            <p className="mt-1">Fotografeer een kookboekpagina of briefje. De tekst wordt gelezen (ook handschrift) en ingevuld — of typ hieronder zelf. <span className="hidden [@media(hover:hover)]:inline">Op de computer kun je een afbeelding ook op deze kaart slepen.</span></p>
          </div>
          <div className="flex flex-wrap items-center gap-3 p-5">
            <input ref={scanCam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pickScan(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={scanFile} type="file" accept="image/*" hidden onChange={(e) => { pickScan(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" className="btn-primary" disabled={scanning !== null} onClick={() => scanCam.current?.click()}>
              <Camera className="h-5 w-5" /> Foto maken
            </button>
            <button type="button" className="btn-outline" disabled={scanning !== null} onClick={() => scanFile.current?.click()}>
              <ImagePlus className="h-5 w-5" /> Afbeelding kiezen
            </button>
            {lastScan && scanning === null && (
              <button type="button" className="btn-ghost" onClick={() => setEditing(lastScan)}>
                <Pencil className="h-5 w-5" /> Foto bewerken en opnieuw scannen
              </button>
            )}
            {scanning !== null && (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {scanMode === "ai" ? "Recept lezen…" : `Tekst herkennen… ${scanning}%`}
              </span>
            )}
          </div>
          {scanText && (
            <details className="border-t-2 border-foreground px-5 py-3 text-muted-foreground">
              <summary className="cursor-pointer font-display text-xl font-bold">Herkende tekst bekijken</summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans">{scanText}</pre>
            </details>
          )}
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <div className="space-y-5">
          <div>
            <label className="label" htmlFor="title">Titel</label>
            <input id="title" className="field text-xl" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bv. Oma's tomatensoep" />
          </div>
          <div>
            <span className="label">Soort</span>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button key={c.id} type="button" onClick={() => setCategory(c.id)} className={`chip ${category === c.id ? "chip-active" : ""}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="servings">Personen</label>
              <input id="servings" type="number" min={1} className="field" value={servings} onChange={(e) => setServings(e.target.value)} onBlur={() => setServings(String(Math.min(100, Math.max(1, Math.round(Number(servings)) || 1))))} inputMode="numeric" />
            </div>
            <div>
              <label className="label" htmlFor="prep">Bereidingstijd (min)</label>
              <input id="prep" type="number" min={0} className="field" value={prep} onChange={(e) => setPrep(e.target.value)} placeholder="30" />
            </div>
          </div>
        </div>
        <div>
          <span className="label">Foto van het gerecht</span>
          <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => { setPhoto(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={photoCam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { setPhoto(e.target.files?.[0]); e.target.value = ""; }} />
          <div {...photoDrop.props} className={`relative rounded-[inherit] ${photoDrop.over ? "outline-dashed outline-4 outline-offset-2 outline-foreground" : ""}`}>
            {image ? (
              <>
                <img src={image} alt="" className="wobbly-sm aspect-square w-full border-2 border-foreground object-cover" />
                <button type="button" aria-label="Foto verwijderen" onClick={() => setImage(null)} className="btn absolute right-2 top-2 h-9 w-9 bg-card p-0 text-foreground"><X className="h-4 w-4" /></button>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn-outline px-3 py-0.5 text-lg" onClick={() => photoCam.current?.click()}><Camera className="h-4 w-4" /> Nieuwe foto</button>
                  <button type="button" className="btn-outline px-3 py-0.5 text-lg" onClick={() => photoRef.current?.click()}><ImagePlus className="h-4 w-4" /> Andere kiezen</button>
                </div>
              </>
            ) : (
              <div className={`wobbly-sm flex aspect-square w-full flex-col items-center justify-center gap-3 border-2 border-dashed border-foreground/60 p-3 text-center transition ${photoDrop.over ? "bg-accent/60" : "bg-card/70"}`}>
                <ImagePlus className="h-8 w-8 text-muted-foreground" />
                <span className="hidden font-display text-xl font-bold text-muted-foreground [@media(hover:hover)]:block">Sleep een foto hierheen</span>
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" className="btn-primary px-3 py-1 text-lg" onClick={() => photoCam.current?.click()}><Camera className="h-5 w-5" /> Foto maken</button>
                  <button type="button" className="btn-outline px-3 py-1 text-lg" onClick={() => photoRef.current?.click()}><ImagePlus className="h-5 w-5" /> Kiezen</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="ing">Ingrediënten <span className="font-sans text-base font-normal text-muted-foreground">— één per regel</span></label>
          <textarea id="ing" rows={10} className="field ruled" value={ingredients} onChange={(e) => setIngredients(e.target.value)} placeholder={"500 g tomaten\n1 ui\n1 l bouillon"} />
        </div>
        <div>
          <label className="label" htmlFor="steps">Bereiding <span className="font-sans text-base font-normal text-muted-foreground">— één stap per regel</span></label>
          <textarea id="steps" rows={10} className="field ruled" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={"Snipper de ui en stoof aan.\nVoeg de tomaten toe..."} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="notes">Notities</label>
        <textarea id="notes" rows={3} className="field ruled" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Tips, variaties, bron…" />
      </div>
      <div className="flex justify-end gap-3">
        <button type="button" className="btn-ghost" onClick={() => (history.length > 1 ? history.back() : navigate({ to: "/" }))}>Annuleren</button>
        <button type="submit" className="btn-primary px-6" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Recept bewaren
        </button>
      </div>
      {editing && (
        <ImageEditor
          file={editing}
          onCancel={() => setEditing(null)}
          onDone={(edited) => {
            setLastScan(editing);
            setEditing(null);
            void runScan(edited);
          }}
        />
      )}
    </form>
  );
}
