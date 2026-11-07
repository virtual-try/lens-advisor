# Inventory fragment — Spec 05 (Field encryption)

### `field-cipher`
`app/shared/crypto/field-cipher.server.ts` — Factory `createFieldCipher({ keys, activeKeyId })` producing a `FieldCipher` that encrypts JSON with AES-256-GCM (random 12-byte IV, 16-byte auth tag, caller AAD) into one base64url token carrying the version and key id. Decrypt selects the key by id (`UnknownKeyError`) and returns parsed JSON only after the auth tag matches (`DecryptError` otherwise).
**Use instead of:** Calling `node:crypto` from feature code, inventing a token format, or storing prescription JSON in plaintext.
**Added by:** spec 05.

### `cipher-container`
`app/shared/container/cipher.server.ts` — Composition root lazy singleton `getCipher()` that builds the shared `FieldCipher` from `getConfig().rx` once. `resetCipher()` drops it (tests).
**Use instead of:** Reading `RX_ENCRYPTION_KEYS` or constructing a cipher in routes, services, or workers.
**Added by:** spec 05.
