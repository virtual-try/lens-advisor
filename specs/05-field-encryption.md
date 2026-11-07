# Spec 05 — Field encryption for prescription data

**Status:** Not started
**Depends on:** Spec 01
**Model:** Heavy — `claude-opus-5-5` · `gpt-6-astra` · `gemini-3.1-pro-preview`
**Issue:** —
**Owns:** `app/shared/crypto/field-cipher.server.ts`, `app/shared/crypto/field-cipher.server.test.ts`, `app/shared/container/cipher.server.ts`, `specs/inventory/05-field-encryption.md`
**Reuses:** `app/shared/config.server.ts` (spec 01)
**Kind:** security
**Invariants:** INV-2

## Goal

A small, audited helper that encrypts and decrypts prescription payloads with AES-256-GCM using Node's
built-in `crypto`, with key ids so keys can be rotated without re-encrypting everything at once.

## Scope

- `createFieldCipher({ keys, activeKeyId })` → `{ encrypt(plaintextJson, aad) → string, decrypt(token, aad) → json }`.
- Token format: version, key id, 12-byte random IV, ciphertext, 16-byte auth tag — one base64url string.
- **AAD** binds a ciphertext to its row: callers pass `shopId:prescriptionId`; decrypting with different
  AAD fails. This stops a ciphertext copied between shops from decrypting.
- Decrypt picks the key by the token's key id; unknown id → `UnknownKeyError`. Tampered token →
  `DecryptError` (never returns garbage).
- Keys come from config only (32 bytes each, base64). The factory validates length at startup.

- Add the lazy getter in `app/shared/container/` (see `ARCHITECTURE.md#hot-files--designed-out`), reading config once.

## Explicit non-scope

- S3 object encryption → spec 06 (server-side encryption).
- Re-encryption job for key rotation → out of MVP (spec 00); README Open questions.
- Which fields are encrypted → spec 22 decides per column.

## Reuse first

- Named in detail: `app/shared/config.server.ts` (spec 01: `RX_ENCRYPTION_KEYS`, `RX_ENCRYPTION_ACTIVE_KEY_ID`)
- Node `crypto` only; no third-party crypto library.
- Config from spec 01's module; never read `process.env` here.

## Wiring

Real, used now: config module (spec 01). Stubbed: none. Consumers: 22, 24, 25.

## Examples

| Case | Expected | Why this row |
| --- | --- | --- |
| encrypt then decrypt, same AAD | original JSON | normal |
| encrypt same plaintext twice | two different tokens | random IV |
| decrypt with AAD of another shop | `DecryptError` | cross-shop copy |
| flip one byte of the token | `DecryptError` | tamper |
| token with key id `k9` not configured | `UnknownKeyError` | rotation gap |
| encrypt with `k2` active, decrypt old `k1` token | original JSON | rotation |
| key of 31 bytes in config | factory throws at startup | invalid key |

## Steps

1. Implement the factory; 2. every Examples row a test; 3. assert error messages contain no plaintext.

## Self-check

1. IV is random per call, never derived from content or a counter in memory.
2. Error objects and messages never include plaintext or key material (INV-2).
3. Auth tag checked before any plaintext is returned.
4. Security checklist (`spec-quality.md` §8).

## Done when

- [x] `pnpm vitest run app/shared/crypto/field-cipher.server.test.ts` passes: every Examples row is a case. [unit]
- [x] Sabotage: pass empty AAD on decrypt → cross-shop row goes red; recorded in the Log. [unit]
- [x] INV-2: a test encrypts a payload with a distinctive SPH string and asserts the token and every thrown error's message do not contain it. [unit]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/05-field-encryption.md` lists `createFieldCipher`. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 05 implemented. `createFieldCipher({ keys, activeKeyId })` in `app/shared/crypto/field-cipher.server.ts` encrypts JSON with AES-256-GCM (`node:crypto` only) and returns one unpadded base64url token. Layout, in order: version byte `1`, key-id length byte, key id (utf-8), 12-byte IV, ciphertext, 16-byte auth tag. Decrypt selects the key by the token's key id. `getCipher()` / `resetCipher()` in `app/shared/container/cipher.server.ts` build that cipher from `getConfig().rx` once and cache it on `globalThis`.
- **2026-11-08** — Decisions:
  - IV is `randomBytes(12)` inside `encrypt`. No counter and no derivation from the plaintext.
  - A one-byte flip of the auth tag is `DecryptError`. A token whose key id is not configured is `UnknownKeyError` (key lookup is before GCM, which is what makes the k9 row possible). A flip that only changes the key id into an unconfigured id is that unknown-key case.
  - Empty AAD is not a special reject. It is a different AAD, so it does not authenticate a token bound to `shopId:prescriptionId`.
  - `decrypt` returns `unknown` (parsed JSON). Spec 22 validates the shape.
  - A key that is not exactly 32 bytes of canonical standard base64 throws `InvalidCipherKeyError` at `createFieldCipher` time. The message is static and does not include the key. Config already rejects this before the factory; the factory checks again.
  - OpenSSL and `JSON.parse` errors are replaced with `DecryptError("Ciphertext could not be authenticated")`. `cause` is not set, because those messages can quote plaintext. `JSON.stringify` failures become `CipherInputError` the same way.
  - `DecryptError` and `UnknownKeyError` do not extend `AppError`, so a stray throw stays on the generic 500 path.
- **2026-11-08** — Self-check:
  1. IV is random per call. Holds. `randomBytes(12)` is inside `encrypt`. The "same plaintext twice" test asserts the tokens differ, the 12-byte IVs differ, and the IVs are not a ±1 counter.
  2. Errors carry no plaintext or key material (INV-2). Holds. Messages are fixed strings. The INV-2 test uses the needle `SPH-NEEDLE-7.75-UNIQUE-RX-VALUE` and asserts it is absent from the token and from every thrown error's message, name, stack, cause, and `JSON.stringify`. The same check covers the base64 key material on the 31-byte factory failure.
  3. Auth tag is checked before plaintext is returned. Holds. `decipher.update()` bytes are kept only until `decipher.final()`; on failure they are zeroed and not attached to the error. JSON.parse runs only after `final()` succeeds. The tamper test expects `DecryptError` with that static message and `cause === undefined`. A fake decipher could not be injected: Vitest cannot spy on `node:crypto` ESM exports, and a `vi.mock` of `node:crypto` did not replace the binding inside the cipher module. The proof is the real GCM failure path.
  4. Security checklist (`spec-quality.md` §8, kind `security`). Lockout counters, biometrics, and a backwards clock do not apply: there is no PIN, attempt counter, or expiry. The allowed path is a matching tag and AAD; the denied path is tested with another shop's AAD, an empty AAD, a flipped tag, a truncated token, an unknown key id, a key id forged to the SPH needle, and a 31-byte key. The auth tag comparison is inside OpenSSL. Owned files have no `process.env`, `console`, or logger call. Plaintext Rx is not logged.
- **2026-11-08** — Sabotage: `aadBuffer()` returned `Buffer.alloc(0)` for both encrypt and decrypt (empty AAD). Decrypt-only would fail every decrypt, including the cross-shop row, so that row would stay green. With both sides unbound, `decrypt(token, otherShopAad)` returned the plaintext. `pnpm vitest run app/shared/crypto/field-cipher.server.test.ts -t "another shop"`: `Tests  1 failed | 12 skipped (13)`. Failure: `expected undefined to be an instance of DecryptError` in "decrypt with the AAD of another shop throws DecryptError". Restored. Re-run after the restore is the green run below.
- **2026-11-08** — Gates, after the last code change:
  - `pnpm vitest run app/shared/crypto/field-cipher.server.test.ts`: Test Files 1 passed (1), Tests 13 passed (13).
  - `pnpm test`: Test Files 16 passed (16), Tests 248 passed (248). Projects in the output: app, rx-core, db. 0 failed.
  - `pnpm typecheck`: exit 0 (`tsc --noEmit` and `pnpm -r typecheck`).
  - `pnpm lint` (`eslint . --max-warnings 0`): exit 0, 0 errors, 0 warnings.
  - `pnpm build`: exit 0.
  - `git diff --check`: clean.
- **2026-11-08** — `specs/inventory/05-field-encryption.md` lists `createFieldCipher` (`field-cipher`) and `getCipher` (`cipher-container`).
- **2026-11-07** — Evidence (orchestro spec verify, tree 0076ef8d): install pass · typecheck pass · lint pass · build pass · test pass 250/0/0
- **2026-11-08** — Fix round R1-F1. GCM additional data is the on-wire header concatenated with the caller context, each `uint32be` length-prefixed: `u32be(headerLen) || version || keyIdLen || keyId || u32be(contextLen) || contextUtf8`. Encrypt and decrypt both pass that buffer to `setAAD`. Before that change, with `k1` and `k2` set to the same key, rewriting the key id still returned plaintext. `pnpm vitest run app/shared/crypto/field-cipher.server.test.ts -t "version byte|share a key|another shop"` on the new tests, cipher not yet binding the header: `Tests  1 failed | 2 passed | 12 skipped (15)`. Failure: `expected undefined to be an instance of DecryptError` in "swapping the key id on a valid ciphertext throws DecryptError when both ids share a key". The version-byte case already threw `DecryptError` from the pre-lookup version check. After the binding, that swap throws `DecryptError` and does not return plaintext.
- **2026-11-08** — Fix round R1-F2. Sabotage was decrypt only: `decipher.setAAD(gcmAad(header, aad))` temporarily became `decipher.setAAD(Buffer.alloc(0))`. Encrypt still bound the real header and context. The cross-shop test requires the original context to open first, so empty AAD on decrypt cannot leave that row green. `pnpm vitest run app/shared/crypto/field-cipher.server.test.ts -t "another shop" --reporter=verbose`:

      ×  app  app/shared/crypto/field-cipher.server.test.ts > createFieldCipher examples > decrypt with the AAD of another shop throws DecryptError 3ms
         → Ciphertext could not be authenticated

      FAIL   app  app/shared/crypto/field-cipher.server.test.ts > createFieldCipher examples > decrypt with the AAD of another shop throws DecryptError
      DecryptError: Ciphertext could not be authenticated
       ❯ Object.decrypt app/shared/crypto/field-cipher.server.ts:246:13
       ❯ app/shared/crypto/field-cipher.server.test.ts:141:19

       Test Files  1 failed (1)
            Tests  1 failed | 14 skipped (15)

  The throw is the matching-context assertion, `decrypt(token, AAD)` at the cited test line. Restored `decipher.setAAD(gcmAad(header, aad))`. Same command after the restore:

      ✓  app  app/shared/crypto/field-cipher.server.test.ts > createFieldCipher examples > decrypt with the AAD of another shop throws DecryptError 4ms

       Test Files  1 passed (1)
            Tests  1 passed | 14 skipped (15)

- **2026-11-08** — Gates, after the restore and the header binding:
  - `pnpm vitest run app/shared/crypto/field-cipher.server.test.ts`: Test Files 1 passed (1), Tests 15 passed (15).
  - `pnpm test`: Test Files 16 passed (16), Tests 250 passed (250). Projects in the output: app, rx-core, db. 0 failed.
  - `pnpm typecheck`: exit 0 (`prisma generate`, `react-router typegen`, `tsc --noEmit`, `pnpm -r typecheck`).
  - `pnpm lint` (`eslint . --max-warnings 0`): exit 0, no findings.
  - `pnpm build`: exit 0.
