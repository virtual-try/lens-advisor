# Spec 05 — Field encryption for prescription data

**Status:** Done
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

- [ ] `pnpm vitest run app/shared/crypto/field-cipher.server.test.ts` passes: every Examples row is a case. [unit]
- [ ] Sabotage: pass empty AAD on decrypt → cross-shop row goes red; recorded in the Log. [unit]
- [ ] INV-2: a test encrypts a payload with a distinctive SPH string and asserts the token and every thrown error's message do not contain it. [unit]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/05-field-encryption.md` lists `createFieldCipher`. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
