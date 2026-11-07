import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Token layout version. Unknown versions are rejected before any key lookup. */
export const FIELD_CIPHER_VERSION = 1;

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const MAX_KEY_ID_BYTES = 255;

/**
 * AES-256-GCM rejected the token: malformed, wrong version, bad auth tag,
 * or AAD mismatch. The message is static and carries no plaintext.
 */
export class DecryptError extends Error {
  constructor(message = "Ciphertext could not be authenticated") {
    super(message);
    this.name = "DecryptError";
  }
}

/** The token names a key id this cipher was not given. */
export class UnknownKeyError extends Error {
  constructor(message = "Unknown encryption key id") {
    super(message);
    this.name = "UnknownKeyError";
  }
}

/** A key or key id failed startup validation. The message never includes key bytes. */
export class InvalidCipherKeyError extends Error {
  constructor(message = "Encryption key must be 32 bytes") {
    super(message);
    this.name = "InvalidCipherKeyError";
  }
}

/** Caller passed plaintext or AAD this cipher will not encrypt. */
export class CipherInputError extends Error {
  constructor(message = "Plaintext is not JSON-serializable") {
    super(message);
    this.name = "CipherInputError";
  }
}

export interface FieldCipher {
  /** Encrypt a JSON value. `aad` is `shopId:prescriptionId`. */
  encrypt(plaintextJson: unknown, aad: string): string;
  /** Decrypt a token. Returns parsed JSON only after the auth tag checks out. */
  decrypt(token: string, aad: string): unknown;
}

export interface FieldCipherOptions {
  /** Key id → standard base64 of exactly 32 bytes. */
  keys: Readonly<Record<string, string>>;
  activeKeyId: string;
}

function serializeHeader(keyId: string): Buffer {
  const keyIdBytes = Buffer.from(keyId, "utf8");
  const header = Buffer.alloc(2 + keyIdBytes.length);
  header[0] = FIELD_CIPHER_VERSION;
  header[1] = keyIdBytes.length;
  keyIdBytes.copy(header, 2);
  return header;
}

function lengthPrefixed(bytes: Buffer): Buffer {
  const out = Buffer.alloc(4 + bytes.length);
  out.writeUInt32BE(bytes.length, 0);
  bytes.copy(out, 4);
  return out;
}

/**
 * GCM additional data is the on-wire header (version, key-id length, key id)
 * concatenated with the caller context. Each field is uint32be length-prefixed
 * so one cannot be shifted into the other.
 */
function gcmAad(header: Buffer, contextAad: string): Buffer {
  return Buffer.concat([
    lengthPrefixed(header),
    lengthPrefixed(Buffer.from(contextAad, "utf8")),
  ]);
}

function wipe(parts: Buffer[]): void {
  for (const part of parts) {
    part.fill(0);
  }
}

function assertAad(aad: unknown): asserts aad is string {
  if (typeof aad !== "string") {
    throw new CipherInputError("AAD must be a string");
  }
}

function decodeKey(encoded: unknown): Buffer {
  if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(encoded)) {
    throw new InvalidCipherKeyError();
  }

  const key = Buffer.from(encoded, "base64");
  const canonical = key.toString("base64");
  const unpadded = canonical.replace(/=+$/, "");
  if (encoded !== canonical && encoded !== unpadded) {
    key.fill(0);
    throw new InvalidCipherKeyError();
  }
  if (key.length !== KEY_LENGTH) {
    key.fill(0);
    throw new InvalidCipherKeyError();
  }
  return key;
}

function serializePlaintext(plaintextJson: unknown): string {
  try {
    const serialized = JSON.stringify(plaintextJson);
    if (typeof serialized !== "string") {
      throw new CipherInputError();
    }
    return serialized;
  } catch (err) {
    if (err instanceof CipherInputError) {
      throw err;
    }
    // JSON.stringify quotes a slice of the value in its own message. Drop it.
    throw new CipherInputError();
  }
}

/**
 * AES-256-GCM cipher for prescription JSON.
 * Token is one base64url string: version, key id, 12-byte IV, ciphertext, 16-byte tag.
 * Callers pass AAD `shopId:prescriptionId` so a ciphertext copied across shops does not decrypt.
 * That context and the version/key-id header are length-prefixed GCM additional data.
 */
export function createFieldCipher(options: FieldCipherOptions): FieldCipher {
  if (options === null || typeof options !== "object") {
    throw new InvalidCipherKeyError("Encryption keys are required");
  }

  const keys = options.keys;
  const activeKeyId = options.activeKeyId;
  if (keys === null || typeof keys !== "object" || typeof activeKeyId !== "string") {
    throw new InvalidCipherKeyError("Encryption keys are required");
  }

  const keyIds = Object.keys(keys);
  if (keyIds.length === 0) {
    throw new InvalidCipherKeyError("At least one encryption key is required");
  }

  const decoded = new Map<string, Buffer>();
  try {
    for (const keyId of keyIds) {
      if (keyId.length === 0 || Buffer.byteLength(keyId, "utf8") > MAX_KEY_ID_BYTES) {
        throw new InvalidCipherKeyError("Encryption key id is invalid");
      }
      decoded.set(keyId, decodeKey(keys[keyId]));
    }
  } catch (err) {
    wipe([...decoded.values()]);
    throw err;
  }

  const activeKey = decoded.get(activeKeyId);
  if (!activeKey) {
    wipe([...decoded.values()]);
    throw new InvalidCipherKeyError("Active encryption key id is not configured");
  }
  // Copy the narrowed key so the encrypt closure does not see Buffer | undefined.
  const encryptionKey = activeKey;

  function encrypt(plaintextJson: unknown, aad: string): string {
    assertAad(aad);
    const json = serializePlaintext(plaintextJson);
    const header = serializeHeader(activeKeyId);

    // Fresh IV every call. Never derived from the plaintext or a counter.
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    cipher.setAAD(gcmAad(header, aad));
    const ciphertext = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    if (tag.length !== AUTH_TAG_LENGTH) {
      throw new CipherInputError("Auth tag length is invalid");
    }

    return Buffer.concat([header, iv, ciphertext, tag]).toString("base64url");
  }

  function decrypt(token: string, aad: string): unknown {
    assertAad(aad);
    if (typeof token !== "string" || token.length === 0) {
      throw new DecryptError();
    }

    const raw = Buffer.from(token, "base64url");
    if (raw.toString("base64url") !== token) {
      throw new DecryptError();
    }
    if (raw.length < 2 + 1 + IV_LENGTH + AUTH_TAG_LENGTH || raw[0] !== FIELD_CIPHER_VERSION) {
      throw new DecryptError();
    }

    const keyIdLen = raw[1];
    if (keyIdLen < 1 || raw.length < 2 + keyIdLen + IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new DecryptError();
    }

    const header = Buffer.from(raw.subarray(0, 2 + keyIdLen));
    const keyId = header.subarray(2).toString("utf8");
    const key = decoded.get(keyId);
    if (!key) {
      throw new UnknownKeyError();
    }

    const ivStart = 2 + keyIdLen;
    const tagStart = raw.length - AUTH_TAG_LENGTH;
    const iv = Buffer.from(raw.subarray(ivStart, ivStart + IV_LENGTH));
    const ciphertext = Buffer.from(raw.subarray(ivStart + IV_LENGTH, tagStart));
    const tag = Buffer.from(raw.subarray(tagStart));

    const decipher = createDecipheriv("aes-256-gcm", key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(tag);
    // Header and caller context are both authenticated. Empty or other-shop
    // context, or a rewritten version or key id, must not authenticate.
    decipher.setAAD(gcmAad(header, aad));

    // update() can yield plaintext before the tag is checked. Hold those bytes
    // until final() succeeds, then drop them on failure without putting them
    // on the error.
    const parts: Buffer[] = [];
    try {
      parts.push(decipher.update(ciphertext));
      parts.push(decipher.final());
    } catch {
      wipe(parts);
      throw new DecryptError();
    }

    const plainBuf = Buffer.concat(parts);
    wipe(parts);

    let parsed: unknown;
    try {
      // JSON.parse is typed as any; narrow it so plaintext cannot flow out as any.
      parsed = JSON.parse(plainBuf.toString("utf8")) as unknown;
    } catch {
      // SyntaxError messages quote the input. Do not wrap that error.
      plainBuf.fill(0);
      throw new DecryptError();
    }
    plainBuf.fill(0);
    return parsed;
  }

  return { encrypt, decrypt };
}
