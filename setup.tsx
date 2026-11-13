import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { beginSetup, completeSetup } from "../lib/auth.functions";

export const Route = createFileRoute("/setup")({
  head: () => ({ meta: [{ title: "Account aanmaken — Dish" }] }),
  component: SetupPage,
});

type Step = "account" | "totp" | "codes";

function SetupPage() {
  const [step, setStep] = useState<Step>("account");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [secret, setSecret] = useState("");
  const [qrSvg, setQrSvg] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toTotp(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 10) return setError("Kies een wachtwoord van minstens 10 tekens (een zin mag ook).");
    if (password !== password2) return setError("De twee wachtwoorden zijn niet gelijk.");
    setBusy(true);
    try {
      const res = await beginSetup({ data: { username } });
      setSecret(res.secret);
      setQrSvg(res.qrSvg);
      setStep("totp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
    } finally {
      setBusy(false);
    }
  }

  async function finish(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await completeSetup({ data: { username, password, secret, code } });
      setRecovery(res.recoveryCodes);
      setStep("codes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Er ging iets mis");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(recovery.join("\n"));
      toast.success("Codes gekopieerd");
    } catch {
      toast.error("Kopiëren mislukt — schrijf ze over");
    }
  }

  const errorBox = error && (
    <p role="alert" className="wobbly-sm border-2 border-destructive bg-card px-3 py-2 text-destructive">{error}</p>
  );

  return (
    <main className="page mx-auto max-w-md pb-20 pt-10">
      <h1 className="mb-2"><span className="scribble">Welkom bij Dish</span></h1>

      {step === "account" && (
        <>
          <p className="mb-6 text-muted-foreground">Stap 1 van 3 — maak je account aan. Dit doe je maar één keer.</p>
          <form onSubmit={toTotp} className="card space-y-4 p-5">
            <div>
              <label className="label" htmlFor="username">Gebruikersnaam</label>
              <input id="username" className="field" value={username} onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" autoCapitalize="none" autoCorrect="off" required minLength={3} maxLength={40} autoFocus />
            </div>
            <div>
              <label className="label" htmlFor="password">Wachtwoord</label>
              <input id="password" type="password" className="field" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password" required minLength={10} />
              <p className="mt-1 text-sm text-muted-foreground">Minstens 10 tekens. Een zin onthoudt makkelijker.</p>
            </div>
            <div>
              <label className="label" htmlFor="password2">Wachtwoord nogmaals</label>
              <input id="password2" type="password" className="field" value={password2} onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password" required />
            </div>
            {errorBox}
            <button type="submit" disabled={busy} className="btn-primary w-full">Volgende</button>
          </form>
        </>
      )}

      {step === "totp" && (
        <>
          <p className="mb-6 text-muted-foreground">Stap 2 van 3 — koppel je authenticator-app (bv. Google Authenticator, Microsoft Authenticator, Aegis of 2FAS).</p>
          <form onSubmit={finish} className="card space-y-4 p-5">
            <div className="mx-auto w-56 border-2 border-foreground bg-white p-1" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <p className="text-center text-sm text-muted-foreground">
              Lukt scannen niet? Typ deze sleutel in je app:
              <br />
              <span className="select-all break-all font-mono text-base text-foreground">{secret.match(/.{1,4}/g)?.join(" ")}</span>
            </p>
            <div>
              <label className="label" htmlFor="code">Code uit de app</label>
              <input id="code" className="field text-2xl tracking-widest" value={code} onChange={(e) => setCode(e.target.value)}
                inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required autoFocus />
            </div>
            {errorBox}
            <button type="submit" disabled={busy} className="btn-primary w-full">
              <ShieldCheck className="h-5 w-5" /> Controleren en bewaren
            </button>
          </form>
        </>
      )}

      {step === "codes" && (
        <>
          <p className="mb-6 text-muted-foreground">Stap 3 van 3 — bewaar je herstelcodes.</p>
          <div className="card space-y-4 p-5">
            <p>
              Raak je je telefoon kwijt, dan kom je met één van deze codes weer binnen. <strong>Elke code werkt maar één keer</strong>, en je ziet ze
              <strong> alleen nu</strong>. Bewaar ze buiten Dish, bv. in je wachtwoordmanager.
            </p>
            <ul className="wobbly-sm grid grid-cols-2 gap-x-4 border-2 border-foreground bg-accent/40 p-3 font-mono text-lg">
              {recovery.map((c) => <li key={c} className="select-all">{c}</li>)}
            </ul>
            <button type="button" onClick={copyCodes} className="btn-outline w-full"><Copy className="h-5 w-5" /> Codes kopiëren</button>
            <label className="flex items-center gap-3 text-lg">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-5 w-5 accent-[var(--primary)]" />
              Ik heb mijn herstelcodes bewaard
            </label>
            <button type="button" disabled={!saved} onClick={() => window.location.assign("/")} className="btn-primary w-full">
              <Check className="h-5 w-5" /> Naar mijn recepten
            </button>
          </div>
        </>
      )}
    </main>
  );
}
