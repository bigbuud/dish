import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { CheckCircle2, CircleAlert, Copy, FileText, FolderInput, ImagePlus, Loader2, Pause, Play, RotateCw } from "lucide-react";
import { importRecipeFile } from "@/lib/import.functions";
import { compressImage } from "@/lib/image";

export const Route = createFileRoute("/importeren")({
  head: () => ({
    meta: [
      { title: "Importeren — Dish" },
      { name: "description", content: "Lees een hele map met PDF's, Word-bestanden en foto's in als recepten." },
    ],
  }),
  component: Importeren,
});

type Status = "wacht" | "bezig" | "klaar" | "dubbel" | "fout";
type Item = { id: number; file: File; name: string; status: Status; note: string; added: number };

type Kind = "image" | "pdf" | "docx" | "text";
const MAX_BYTES = 6_500_000; // base64 wordt ~4/3 groter; de server accepteert max ~9 MB tekst
const RETRY_WAIT = [20, 60, 120]; // seconden, bij "limiet bereikt" of overbelasting

function kindOf(f: File): Kind | "doc" | null {
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "doc") return "doc";
  if (ext === "txt") return "text";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  return null;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function Importeren() {
  const qc = useQueryClient();
  const send = useServerFn(importRecipeFile);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [pausedNote, setPausedNote] = useState("");
  const [over, setOver] = useState(false);
  const itemsRef = useRef<Item[]>([]);
  const runningRef = useRef(false);
  const stopRef = useRef(false);
  const nextId = useRef(1);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function setAll(next: Item[]) {
    itemsRef.current = next;
    setItems(next);
  }
  function patch(id: number, p: Partial<Item>) {
    setAll(itemsRef.current.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }

  // Waarschuw bij het sluiten van de pagina terwijl de wachtrij loopt.
  useEffect(() => {
    if (!running) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running]);

  function addFiles(list: FileList | File[]) {
    const known = new Set(itemsRef.current.map((i) => `${i.name}|${i.file.size}`));
    const added: Item[] = [];
    for (const file of Array.from(list)) {
      const name = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      if (file.name.startsWith("~$") || file.name.startsWith(".")) continue; // tijdelijke Word-bestanden
      if (known.has(`${name}|${file.size}`)) continue;
      known.add(`${name}|${file.size}`);
      const k = kindOf(file);
      let status: Status = "wacht";
      let note = "";
      if (!k) { status = "fout"; note = "Bestandstype wordt niet ondersteund"; }
      else if (k === "doc") { status = "fout"; note = "Oud Word-formaat (.doc): sla het op als .docx"; }
      else if (file.size > MAX_BYTES) { status = "fout"; note = "Bestand is te groot (max. 6 MB)"; }
      added.push({ id: nextId.current++, file, name, status, note, added: 0 });
    }
    if (!added.length) return;
    setAll([...itemsRef.current, ...added]);
    if (added.some((a) => a.status === "wacht")) void run();
  }

  async function sleep(seconds: number, id: number, label: string) {
    for (let s = seconds; s > 0; s--) {
      if (stopRef.current) return;
      patch(id, { note: `${label}, opnieuw over ${s} s…` });
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async function process(item: Item): Promise<"ok" | "pause"> {
    const k = kindOf(item.file) as Kind;
    let data: string, mime: string;
    try {
      if (k === "image") {
        const url = await compressImage(item.file, 2000);
        mime = url.slice(5, url.indexOf(";"));
        data = url.slice(url.indexOf(",") + 1);
      } else {
        mime = item.file.type || "application/octet-stream";
        data = toBase64(await item.file.arrayBuffer());
      }
    } catch {
      patch(item.id, { status: "fout", note: "Bestand kon niet geopend worden" });
      return "ok";
    }
    for (let attempt = 0; ; attempt++) {
      patch(item.id, { status: "bezig", note: "Lezen…" });
      let res;
      try {
        res = await send({ data: { name: item.name, kind: k, mime, data } });
      } catch (e) {
        res = { ok: false as const, reason: "busy" as const, message: (e as Error).message || "Verbinding mislukt" };
      }
      if (res.ok) {
        const n = res.added.length, d = res.duplicates.length;
        if (n) patch(item.id, { status: "klaar", added: n, note: `${n} ${n === 1 ? "recept" : "recepten"}: ${res.added.slice(0, 3).join(", ")}${n > 3 ? "…" : ""}${d ? ` (${d} dubbel overgeslagen)` : ""}` });
        else if (d) patch(item.id, { status: "dubbel", note: `Al in je schrift: ${res.duplicates.slice(0, 3).join(", ")}` });
        else patch(item.id, { status: "fout", note: "Geen recept gevonden in dit bestand" });
        void qc.invalidateQueries({ queryKey: ["recipes"] });
        return "ok";
      }
      if (res.reason === "no-key") {
        patch(item.id, { status: "wacht", note: "" });
        setPausedNote("Er is geen Gemini-sleutel ingesteld op de server.");
        return "pause";
      }
      const retryable = res.reason === "limit" || res.reason === "busy";
      if (!retryable) { patch(item.id, { status: "fout", note: res.message }); return "ok"; }
      if (attempt >= RETRY_WAIT.length) {
        patch(item.id, { status: "wacht", note: "" });
        setPausedNote(`${res.message}. De wachtrij is gepauzeerd; druk op Hervat om later verder te gaan.`);
        return "pause";
      }
      await sleep(RETRY_WAIT[attempt], item.id, res.reason === "limit" ? "Limiet bereikt" : res.message);
      if (stopRef.current) { patch(item.id, { status: "wacht", note: "" }); return "pause"; }
    }
  }

  async function run() {
    if (runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;
    setRunning(true);
    setPausedNote("");
    try {
      for (;;) {
        if (stopRef.current) break;
        const next = itemsRef.current.find((i) => i.status === "wacht");
        if (!next) break;
        if ((await process(next)) === "pause") break;
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  function retryFailed() {
    setAll(itemsRef.current.map((i) => (i.status === "fout" && kindOf(i.file) && kindOf(i.file) !== "doc" && i.file.size <= MAX_BYTES ? { ...i, status: "wacht", note: "" } : i)));
    void run();
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    addFiles(e.dataTransfer.files);
  };

  const count = (s: Status) => items.filter((i) => i.status === s).length;
  const total = items.length;
  const done = count("klaar") + count("dubbel") + count("fout");
  const recipesAdded = items.reduce((n, i) => n + i.added, 0);
  const canRetry = items.some((i) => i.status === "fout" && kindOf(i.file) && kindOf(i.file) !== "doc" && i.file.size <= MAX_BYTES);

  return (
    <main className="page mx-auto max-w-3xl pb-20 pt-8">
      <h1 className="mb-2"><span className="scribble">Recepten importeren</span></h1>
      <p className="mb-6 text-muted-foreground">Kies een map (of een paar bestanden) met PDF's, Word-bestanden en foto's. Dish leest ze één voor één en bewaart de recepten met het label “Te controleren”.</p>

      <section
        onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
        onDrop={onDrop}
        className={`card p-5 transition ${over ? "bg-accent/40 outline-dashed outline-4 outline-offset-2 outline-foreground" : ""}`}
      >
        <input ref={folderInput} type="file" multiple hidden {...({ webkitdirectory: "" } as object)} onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={fileInput} type="file" multiple hidden accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp,image/*" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" onClick={() => folderInput.current?.click()}><FolderInput className="h-5 w-5" /> Map kiezen</button>
          <button type="button" className="btn-outline" onClick={() => fileInput.current?.click()}><ImagePlus className="h-5 w-5" /> Bestanden kiezen</button>
          <span className="hidden text-muted-foreground [@media(hover:hover)]:inline">of sleep ze hierheen</span>
        </div>
        <p className="mt-3 text-base text-muted-foreground">Ondersteund: PDF, Word (.docx), tekst (.txt), JPG, PNG en WebP. Laat deze pagina open staan tot de wachtrij klaar is.</p>
      </section>

      {total > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="mr-auto">{done} van {total} bestanden{recipesAdded > 0 && ` · ${recipesAdded} ${recipesAdded === 1 ? "recept" : "recepten"} toegevoegd`}</h2>
            {running ? (
              <button type="button" className="btn-outline" onClick={() => { stopRef.current = true; }}><Pause className="h-5 w-5" /> Pauzeer</button>
            ) : count("wacht") > 0 ? (
              <button type="button" className="btn-primary" onClick={() => void run()}><Play className="h-5 w-5" /> Hervat</button>
            ) : null}
            {!running && canRetry && <button type="button" className="btn-outline" onClick={retryFailed}><RotateCw className="h-5 w-5" /> Mislukte opnieuw</button>}
          </div>
          {pausedNote && <p className="card mb-3 bg-accent/60 px-4 py-3">{pausedNote}</p>}
          <ul className="card divide-y-2 divide-foreground/15 overflow-hidden">
            {items.map((i) => (
              <li key={i.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-1 shrink-0">
                  {i.status === "bezig" ? <Loader2 className="h-5 w-5 animate-spin" />
                    : i.status === "klaar" ? <CheckCircle2 className="h-5 w-5 text-primary" />
                    : i.status === "dubbel" ? <Copy className="h-5 w-5 text-muted-foreground" />
                    : i.status === "fout" ? <CircleAlert className="h-5 w-5 text-destructive" />
                    : <FileText className="h-5 w-5 text-muted-foreground" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-bold">{i.name}</span>
                  <span className={`block break-words text-base ${i.status === "fout" ? "text-destructive" : "text-muted-foreground"}`}>
                    {i.note || (i.status === "wacht" ? "In de wachtrij" : "")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {!running && recipesAdded > 0 && count("wacht") === 0 && (
            <div className="mt-6"><Link to="/" className="btn-primary">Naar mijn recepten</Link></div>
          )}
        </section>
      )}
    </main>
  );
}
