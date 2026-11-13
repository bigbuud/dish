// Alleen op de server. Account, 2FA en sessies staan in `${DATA_DIR}/auth.json` (rechten 0600).
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { deleteCookie, getCookie, getRequestHeader, getRequestUrl, setCookie, setResponseStatus } from "@tanstack/react-start/server";
import {
  generateTotpSecret,
  hashPassword,
  hashRecoveryCode,
  isValidTotpSecret,
  newRecoveryCode,
  otpauthUri,
  sha256,
  verifyPassword,
  verifyTotp,
} from "./totp";

export const COOKIE = "dish_session";
export const UNAUTHENTICATED = "Niet ingelogd";

/** Een sessie blijft geldig zolang je hem binnen zoveel dagen gebruikt (schuivend). Standaard een jaar. */
const SESSION_MS = (Number(process.env.SESSION_DAYS) || 365) * 86_400_000;
const COOKIE_MAX_AGE_S = 400 * 86_400; // browsers kappen cookies af op 400 dagen
const TOUCH_AFTER_MS = 12 * 3_600_000;
const MAX_SESSIONS = 25;

type User = {
  username: string;
  passwordHash: string;
  totpSecret: string;
  lastTotpStep: number;
  recoveryHashes: string[];
  createdAt: string;
};
type Session = { id: string; createdAt: number; lastSeen: number; userAgent: string };
type AuthData = { user?: User; sessions: Session[] };

// ---- opslag ----------------------------------------------------------------

const dataDir = () => process.env.DATA_DIR || path.resolve("data");
const file = () => path.join(dataDir(), "auth.json");
let queue: Promise<unknown> = Promise.resolve();

async function readAuth(): Promise<AuthData> {
  try {
    const data = JSON.parse(await fs.readFile(file(), "utf8")) as AuthData;
    return { user: data.user, sessions: data.sessions ?? [] };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { sessions: [] };
    throw e;
  }
}

function mutateAuth<T>(fn: (d: AuthData) => T): Promise<T> {
  const run = queue.then(async () => {
    const data = await readAuth();
    const result = fn(data);
    await fs.mkdir(dataDir(), { recursive: true });
    const tmp = file() + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await fs.rename(tmp, file());
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function hasUser(): Promise<boolean> {
  return !!(await readAuth()).user;
}

// ---- cookie ------------------------------------------------------------------

function isHttps(): boolean {
  const proto = getRequestHeader("x-forwarded-proto");
  if (proto) return proto.split(",")[0]!.trim() === "https";
  return getRequestUrl().protocol === "https:";
}

function setSessionCookie(token: string) {
  setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(),
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
  });
}

// ---- sessies -----------------------------------------------------------------

async function createSession(): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const userAgent = (getRequestHeader("user-agent") ?? "").slice(0, 200);
  await mutateAuth((d) => {
    d.sessions = d.sessions.filter((s) => now - s.lastSeen < SESSION_MS);
    d.sessions.push({ id: sha256(token), createdAt: now, lastSeen: now, userAgent });
    d.sessions = d.sessions.slice(-MAX_SESSIONS);
  });
  setSessionCookie(token);
}

/** Is de huidige cookie een geldige sessie? Verlengt de sessie en de cookie zo nodig. */
export async function isAuthed(): Promise<boolean> {
  const token = getCookie(COOKIE);
  if (!token) return false;
  const id = sha256(token);
  const now = Date.now();
  const session = (await readAuth()).sessions.find((s) => s.id === id);
  if (!session || now - session.lastSeen > SESSION_MS) return false;
  if (now - session.lastSeen > TOUCH_AFTER_MS) {
    await mutateAuth((d) => {
      const s = d.sessions.find((x) => x.id === id);
      if (s) s.lastSeen = now;
    });
    try {
      setSessionCookie(token);
    } catch {
      /* antwoord is al onderweg: de volgende request verlengt hem wel */
    }
  }
  return true;
}

export async function assertAuthed(): Promise<void> {
  if (!(await isAuthed())) {
    setResponseStatus(401);
    throw new Error(UNAUTHENTICATED);
  }
}

export async function logout(): Promise<void> {
  const token = getCookie(COOKIE);
  if (token) {
    const id = sha256(token);
    await mutateAuth((d) => {
      d.sessions = d.sessions.filter((s) => s.id !== id);
    });
  }
  deleteCookie(COOKIE, { path: "/" });
}

/** Logt op alle apparaten uit (bv. als je telefoon kwijt is). */
export async function logoutEverywhere(): Promise<void> {
  await mutateAuth((d) => {
    d.sessions = [];
  });
  deleteCookie(COOKIE, { path: "/" });
}

// ---- inlogpogingen beperken ----------------------------------------------------

const WINDOW_MS = 15 * 60_000;
const MAX_FAILS_PER_IP = 5;
const MAX_FAILS_GLOBAL = 30;
const fails = new Map<string, { n: number; since: number }>();

function failCount(key: string): number {
  const e = fails.get(key);
  if (!e || Date.now() - e.since > WINDOW_MS) return 0;
  return e.n;
}
function addFail(key: string) {
  const e = fails.get(key);
  if (!e || Date.now() - e.since > WINDOW_MS) fails.set(key, { n: 1, since: Date.now() });
  else e.n++;
}
function clientKey(): string {
  const xff = getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || getRequestHeader("x-real-ip") || "local";
}

let dummyHash: Promise<string> | undefined;

// ---- account aanmaken ---------------------------------------------------------

export async function beginSetup(username: string) {
  if (await hasUser()) throw new Error("Er bestaat al een account.");
  const secret = generateTotpSecret();
  const uri = otpauthUri(secret, username);
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, color: { dark: "#1a1a2e", light: "#ffffff" } });
  return { secret, qrSvg };
}

export async function completeSetup(input: { username: string; password: string; secret: string; code: string }) {
  if (await hasUser()) throw new Error("Er bestaat al een account.");
  if (!isValidTotpSecret(input.secret)) throw new Error("Ongeldige 2FA-sleutel. Begin opnieuw.");
  const step = verifyTotp(input.secret, input.code);
  if (step === null) throw new Error("Die code klopt niet. Controleer de tijd op je telefoon en probeer opnieuw.");

  const passwordHash = await hashPassword(input.password);
  const recoveryCodes = Array.from({ length: 10 }, newRecoveryCode);
  await mutateAuth((d) => {
    if (d.user) throw new Error("Er bestaat al een account.");
    d.user = {
      username: input.username,
      passwordHash,
      totpSecret: input.secret,
      lastTotpStep: step,
      recoveryHashes: recoveryCodes.map(hashRecoveryCode),
      createdAt: new Date().toISOString(),
    };
  });
  await createSession();
  return { recoveryCodes };
}

// ---- inloggen --------------------------------------------------------------------

export async function login(input: { username: string; password: string; code: string }) {
  const key = clientKey();
  if (failCount(key) >= MAX_FAILS_PER_IP || failCount("*") >= MAX_FAILS_GLOBAL) {
    setResponseStatus(429);
    throw new Error("Te veel pogingen. Probeer het over 15 minuten opnieuw.");
  }

  const user = (await readAuth()).user;
  const userMatches = !!user && user.username.toLowerCase() === input.username.trim().toLowerCase();
  dummyHash ??= hashPassword("dish-dummy");
  const passwordOk = await verifyPassword(input.password, userMatches ? user!.passwordHash : await dummyHash);

  let ok = false;
  if (userMatches && passwordOk) {
    const clean = input.code.replace(/\s/g, "");
    if (/^\d{6}$/.test(clean)) {
      const step = verifyTotp(user!.totpSecret, clean, Date.now(), user!.lastTotpStep);
      if (step !== null) {
        ok = true;
        await mutateAuth((d) => {
          if (d.user) d.user.lastTotpStep = Math.max(d.user.lastTotpStep, step);
        });
      }
    } else {
      // herstelcode: één keer bruikbaar
      const hash = hashRecoveryCode(clean);
      ok = await mutateAuth((d) => {
        const i = d.user?.recoveryHashes.indexOf(hash) ?? -1;
        if (i < 0) return false;
        d.user!.recoveryHashes.splice(i, 1);
        return true;
      });
    }
  }

  if (!ok) {
    addFail(key);
    addFail("*");
    setResponseStatus(401);
    throw new Error("Gebruikersnaam, wachtwoord of code klopt niet.");
  }

  fails.delete(key);
  await createSession();
  return { ok: true };
}
