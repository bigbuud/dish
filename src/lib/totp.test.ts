import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hashPassword,
  hashRecoveryCode,
  hotp,
  isValidTotpSecret,
  newRecoveryCode,
  verifyPassword,
  verifyTotp,
} from "./totp";

// RFC 6238, bijlage B: geheim "12345678901234567890", SHA-1
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("base32 roundtrip", () => {
    const s = generateTotpSecret();
    expect(isValidTotpSecret(s)).toBe(true);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });

  it("klopt met de RFC 6238 testvectoren", () => {
    expect(hotp(RFC_SECRET, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(hotp(RFC_SECRET, Math.floor(1111111109 / 30), 8)).toBe("07081804");
    expect(hotp(RFC_SECRET, Math.floor(20000000000 / 30), 8)).toBe("65353130");
  });

  it("accepteert huidige code en ±1 stap, weigert de rest", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 2), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", now)).toBeNull();
  });

  it("laat dezelfde code niet twee keer toe", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30000);
    const code = hotp(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, now, step - 1)).toBe(step);
  });

  it("spaties in de code worden genegeerd", () => {
    const now = 1_700_000_000_000;
    const code = hotp(RFC_SECRET, Math.floor(now / 30000));
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).not.toBeNull();
  });
});

describe("wachtwoord en herstelcodes", () => {
  it("hash en verify", async () => {
    const h = await hashPassword("correct paard batterij");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct paard batterij", h)).toBe(true);
    expect(await verifyPassword("fout", h)).toBe(false);
    expect(await verifyPassword("x", "kapot")).toBe(false);
  });

  it("herstelcode: formaat en hash is hoofdletter- en streepjes-onafhankelijk", () => {
    const c = newRecoveryCode();
    expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    expect(hashRecoveryCode(c)).toBe(hashRecoveryCode(c.toLowerCase().replace("-", " ")));
  });
});
