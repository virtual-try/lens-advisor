import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError, resetConfigCache } from "../config.server";
import * as configModule from "../config.server";
import { getCipher, resetCipher } from "../container/cipher.server";
import {
  CipherInputError,
  createFieldCipher,
  DecryptError,
  FIELD_CIPHER_VERSION,
  InvalidCipherKeyError,
  UnknownKeyError,
  type FieldCipher,
} from "./field-cipher.server";

const IV_LENGTH = 12;
const NEEDLE = "SPH-NEEDLE-7.75-UNIQUE-RX-VALUE";
const AAD = "shop-a.example:rx-100";
const OTHER_SHOP_AAD = "shop-b.example:rx-100";

const KEY_K1 = Buffer.alloc(32, 0x11).toString("base64");
const KEY_K2 = Buffer.alloc(32, 0x22).toString("base64");
const KEY_K9 = Buffer.alloc(32, 0x33).toString("base64");

const payload = {
  od: { sph: NEEDLE, cyl: -50, axis: 80 },
  os: { sph: -125 },
  pd: { single: 630 },
  notes: "fixture-note",
};

function cipherWith(activeKeyId: string, keys: Record<string, string>): FieldCipher {
  return createFieldCipher({ keys, activeKeyId });
}

function primaryCipher(): FieldCipher {
  return cipherWith("k1", { k1: KEY_K1 });
}

function tokenParts(token: string): { version: number; keyId: string; iv: Buffer } {
  const raw = Buffer.from(token, "base64url");
  const keyIdLen = raw[1] ?? 0;
  return {
    version: raw[0] ?? -1,
    keyId: raw.subarray(2, 2 + keyIdLen).toString("utf8"),
    iv: Buffer.from(raw.subarray(2 + keyIdLen, 2 + keyIdLen + IV_LENGTH)),
  };
}

function flipLastByte(token: string): string {
  const raw = Buffer.from(token, "base64url");
  raw[raw.length - 1] ^= 0xff;
  return raw.toString("base64url");
}

function ivDistanceIsOne(left: Buffer, right: Buffer): boolean {
  const a = BigInt(`0x${left.toString("hex")}`);
  const b = BigInt(`0x${right.toString("hex")}`);
  return a + 1n === b || b + 1n === a;
}

function expectNoLeak(err: unknown, secret: string): void {
  expect(err).toBeInstanceOf(Error);
  const error = err as Error & { cause?: unknown };
  expect(error.message).not.toContain(secret);
  expect(error.name).not.toContain(secret);
  expect(error.stack ?? "").not.toContain(secret);
  expect(String(error)).not.toContain(secret);
  if (error.cause !== undefined) {
    expect(String(error.cause)).not.toContain(secret);
    if (error.cause instanceof Error) {
      expect(error.cause.message).not.toContain(secret);
    }
  }
  expect(JSON.stringify(error)).not.toContain(secret);
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

describe("createFieldCipher examples", () => {
  it("encrypt then decrypt with the same AAD returns the original JSON", () => {
    const cipher = primaryCipher();
    const token = cipher.encrypt(payload, AAD);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain(NEEDLE);
    expect(JSON.stringify(payload)).not.toBe(token);

    const parts = tokenParts(token);
    expect(parts.version).toBe(FIELD_CIPHER_VERSION);
    expect(parts.keyId).toBe("k1");
    expect(parts.iv).toHaveLength(IV_LENGTH);

    expect(cipher.decrypt(token, AAD)).toEqual(payload);
  });

  it("encrypting the same plaintext twice yields different tokens", () => {
    const cipher = primaryCipher();
    const first = cipher.encrypt(payload, AAD);
    const second = cipher.encrypt(payload, AAD);

    expect(first).not.toBe(second);
    const firstIv = tokenParts(first).iv;
    const secondIv = tokenParts(second).iv;
    expect(firstIv.equals(secondIv)).toBe(false);
    expect(ivDistanceIsOne(firstIv, secondIv)).toBe(false);
    expect(cipher.decrypt(first, AAD)).toEqual(payload);
    expect(cipher.decrypt(second, AAD)).toEqual(payload);
  });

  it("decrypt with the AAD of another shop throws DecryptError", () => {
    const cipher = primaryCipher();
    const token = cipher.encrypt(payload, AAD);

    const err = catchError(() => cipher.decrypt(token, OTHER_SHOP_AAD));
    expect(err).toBeInstanceOf(DecryptError);
    expect(err).not.toBeInstanceOf(UnknownKeyError);
    expect((err as Error).message).toBe("Ciphertext could not be authenticated");
    expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
    expectNoLeak(err, NEEDLE);

    const emptyAad = catchError(() => cipher.decrypt(token, ""));
    expect(emptyAad).toBeInstanceOf(DecryptError);
    expectNoLeak(emptyAad, NEEDLE);
  });

  it("flipping one byte of the token throws DecryptError", () => {
    const cipher = primaryCipher();
    const token = cipher.encrypt(payload, AAD);
    const tampered = flipLastByte(token);

    expect(tampered).not.toBe(token);
    const err = catchError(() => cipher.decrypt(tampered, AAD));
    expect(err).toBeInstanceOf(DecryptError);
    expect(err).not.toBeInstanceOf(UnknownKeyError);
    expect((err as Error).message).toBe("Ciphertext could not be authenticated");
    expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
    expectNoLeak(err, NEEDLE);
  });

  it("a token with key id k9 not configured throws UnknownKeyError", () => {
    const issuer = cipherWith("k9", { k1: KEY_K1, k9: KEY_K9 });
    const token = issuer.encrypt(payload, AAD);
    expect(tokenParts(token).keyId).toBe("k9");

    const reader = primaryCipher();
    const err = catchError(() => reader.decrypt(token, AAD));
    expect(err).toBeInstanceOf(UnknownKeyError);
    expect(err).not.toBeInstanceOf(DecryptError);
    expectNoLeak(err, NEEDLE);
    expect((err as Error).message).not.toContain("k9");
  });

  it("encrypts with k2 active and still decrypts an older k1 token", () => {
    const old = primaryCipher();
    const oldToken = old.encrypt(payload, AAD);
    expect(tokenParts(oldToken).keyId).toBe("k1");

    const rotated = cipherWith("k2", { k1: KEY_K1, k2: KEY_K2 });
    expect(rotated.decrypt(oldToken, AAD)).toEqual(payload);

    const fresh = rotated.encrypt(payload, AAD);
    expect(tokenParts(fresh).keyId).toBe("k2");
    expect(fresh).not.toContain(NEEDLE);
    expect(rotated.decrypt(fresh, AAD)).toEqual(payload);
  });

  it("a 31-byte key makes the factory throw at startup", () => {
    const secret = Buffer.alloc(31, 0x5a);
    const encoded = secret.toString("base64");

    const err = catchError(() => cipherWith("k1", { k1: encoded }));
    expect(err).toBeInstanceOf(InvalidCipherKeyError);
    expect(err).not.toBeInstanceOf(DecryptError);
    expectNoLeak(err, encoded);
    expectNoLeak(err, secret.toString("utf8"));
    expect((err as Error).message).toBe("Encryption key must be 32 bytes");
  });
});

describe("INV-2 plaintext and key material stay out of tokens and errors", () => {
  it("hides the SPH string in the token and in every thrown error message", () => {
    const cipher = primaryCipher();
    const token = cipher.encrypt(payload, AAD);

    expect(token).not.toContain(NEEDLE);
    expect(Buffer.from(token, "base64url").toString("utf8")).not.toContain(NEEDLE);

    const errors = [
      catchError(() => cipher.decrypt(token, OTHER_SHOP_AAD)),
      catchError(() => cipher.decrypt(token, "")),
      catchError(() => cipher.decrypt(flipLastByte(token), AAD)),
      catchError(() => cipher.decrypt(token + "=", AAD)),
      catchError(() => cipher.decrypt("", AAD)),
      catchError(() => cipher.decrypt(token.slice(0, 8), AAD)),
      catchError(() => primaryCipher().decrypt(
        cipherWith("k9", { k9: KEY_K9 }).encrypt(payload, AAD),
        AAD,
      )),
      catchError(() => cipherWith("k1", { k1: NEEDLE })),
      catchError(() => {
        const circular: { sph: string; self?: unknown } = { sph: NEEDLE };
        circular.self = circular;
        cipher.encrypt(circular, AAD);
      }),
    ];

    expect(errors[errors.length - 1]).toBeInstanceOf(CipherInputError);
    expect((errors[errors.length - 1] as Error).message).toBe(
      "Plaintext is not JSON-serializable",
    );

    expect(errors.every((err) => err instanceof Error)).toBe(true);
    for (const err of errors) {
      expectNoLeak(err, NEEDLE);
      expectNoLeak(err, KEY_K1);
      expectNoLeak(err, KEY_K9);
    }
  });

  it("does not treat a key id forged to the SPH string as something to echo", () => {
    const cipher = primaryCipher();
    const forgedId = Buffer.from(NEEDLE, "utf8");
    const raw = Buffer.concat([
      Buffer.from([FIELD_CIPHER_VERSION, forgedId.length]),
      forgedId,
      Buffer.alloc(IV_LENGTH, 1),
      Buffer.alloc(16, 2),
      Buffer.alloc(16, 3),
    ]);
    const err = catchError(() => cipher.decrypt(raw.toString("base64url"), AAD));
    expect(err).toBeInstanceOf(UnknownKeyError);
    expectNoLeak(err, NEEDLE);
  });
});

describe("startup validation", () => {
  it("rejects an active key id that is not in the key set", () => {
    const err = catchError(() => cipherWith("k2", { k1: KEY_K1 }));
    expect(err).toBeInstanceOf(InvalidCipherKeyError);
    expect((err as Error).message).toBe("Active encryption key id is not configured");
    expectNoLeak(err, KEY_K1);
  });

  it("rejects an empty key set", () => {
    const err = catchError(() => cipherWith("k1", {}));
    expect(err).toBeInstanceOf(InvalidCipherKeyError);
    expect((err as Error).message).toBe("At least one encryption key is required");
  });
});

describe("getCipher", () => {
  beforeEach(() => {
    resetCipher();
    resetConfigCache();
  });

  afterEach(() => {
    resetCipher();
    resetConfigCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not build a cipher when encryption keys are missing", () => {
    vi.stubEnv("RX_ENCRYPTION_KEYS", "");
    vi.stubEnv("RX_ENCRYPTION_ACTIVE_KEY_ID", "");
    expect(() => getCipher()).toThrow(ConfigError);
  });

  it("reads config once and keeps that cipher", () => {
    vi.stubEnv("RX_ENCRYPTION_KEYS", JSON.stringify({ k1: KEY_K1, k2: KEY_K2 }));
    vi.stubEnv("RX_ENCRYPTION_ACTIVE_KEY_ID", "k2");

    const spy = vi.spyOn(configModule, "getConfig");
    const first = getCipher();
    const token = first.encrypt(payload, AAD);
    expect(tokenParts(token).keyId).toBe("k2");

    const second = getCipher();
    expect(second).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.decrypt(token, AAD)).toEqual(payload);

    vi.stubEnv("RX_ENCRYPTION_KEYS", JSON.stringify({ k1: KEY_K9 }));
    vi.stubEnv("RX_ENCRYPTION_ACTIVE_KEY_ID", "k1");
    resetConfigCache();

    const third = getCipher();
    expect(third).toBe(first);
    expect(third.decrypt(token, AAD)).toEqual(payload);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
