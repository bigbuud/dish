import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { login } from "../lib/auth.functions";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({
    next: typeof s.next === "string" && s.next.startsWith("/delen") ? s.next : undefined,
  }),
  head: () => ({ meta: [{ title: "Inloggen — Dish" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { next } = Route.useSearch();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login({ data: { username, password, code } });
      // Volledig herladen: nieuwe cookie, schone staat.
      window.location.assign(next ?? "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inloggen mislukt");
      setCode("");
      setBusy(false);
    }
  }

  return (
    <main className="page mx-auto max-w-md pb-20 pt-10">
      <h1 className="mb-2"><span className="scribble">Inloggen</span></h1>
      <p className="mb-6 text-muted-foreground">Welkom terug bij je receptenschrift.</p>
      <form onSubmit={submit} className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="username">Gebruikersnaam</label>
          <input id="username" className="field" value={username} onChange={(e) => setUsername(e.target.value)}
            autoComplete="username" autoCapitalize="none" autoCorrect="off" required autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="password">Wachtwoord</label>
          <input id="password" type="password" className="field" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" required />
        </div>
        <div>
          <label className="label" htmlFor="code">Code uit je authenticator-app</label>
          <input id="code" className="field text-2xl tracking-widest" value={code} onChange={(e) => setCode(e.target.value)}
            inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required />
          <p className="mt-1 text-sm text-muted-foreground">Telefoon kwijt? Vul dan een herstelcode in (zoals ABCDE-FGHIJ).</p>
        </div>
        {error && <p role="alert" className="wobbly-sm border-2 border-destructive bg-card px-3 py-2 text-destructive">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          <KeyRound className="h-5 w-5" /> {busy ? "Even geduld…" : "Inloggen"}
        </button>
        <p className="text-center text-sm text-muted-foreground">Op je telefoon blijf je daarna lang ingelogd.</p>
      </form>
    </main>
  );
}
