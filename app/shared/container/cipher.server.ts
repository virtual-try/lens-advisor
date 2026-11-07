import { getConfig } from "../config.server";
import { createFieldCipher, type FieldCipher } from "../crypto/field-cipher.server";

declare global {
  var __fieldCipher: FieldCipher | undefined;
}

/** Lazy singleton. Reads `getConfig().rx` once, on first use. */
export function getCipher(): FieldCipher {
  if (!global.__fieldCipher) {
    const rx = getConfig().rx;
    global.__fieldCipher = createFieldCipher({
      keys: rx.keys,
      activeKeyId: rx.activeKeyId,
    });
  }
  return global.__fieldCipher;
}

export function resetCipher(): void {
  global.__fieldCipher = undefined;
}
