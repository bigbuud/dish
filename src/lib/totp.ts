// Kleine, afhankelijkheidsvrije bouwstenen voor 2-stapsverificatie (RFC 4226 / 6238) en wachtwoorden.
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Ongeldige base32-tekst");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const TOTP_STEP_MS = 30_000;

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20)); // 160 bit, 32 tekens
}

export function isValidTotpSecret(secret: string): boolean {
  return /^[A-Z2-7]{32}$/.test(secret);
}

export function hotp(secret: string, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1]! & 0x0f;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Controleert een 6-cijferige code (±1 stap voor klokverschil).
 * Geeft de gebruikte tijdstap terug, of null. Met `afterStep` kan een eerder gebruikte code niet opnieuw worden gebruikt.
 */
export function verifyTotp(secret: string, code: string, now = Date.now(), afterStep = -1): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const current = Math.floor(now / TOTP_STEP_MS);
  for (const delta of [0, -1, 1]) {
    const step = current + delta;
    if (step > afterStep && safeEqual(hotp(secret, step), clean)) return step;
  }
  return null;
}

export function otpauthUri(secret: string, username: string): string {
  const label = encodeURIComponent(`Dish:${username}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Dish&algorithm=SHA1&digits=6&period=30`;
}

// ---- Herstelcodes ----------------------------------------------------------

export function newRecoveryCode(): string {
  const raw = base32Encode(randomBytes(7)).slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

// ---- Wachtwoorden (scrypt) --------------------------------------------------

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scryptAsync(password.normalize("NFKC"), Buffer.from(saltB64, "base64"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
