import {
  TEMPLATE_ERROR_CODES,
  type ParsedTemplateToken,
  type TemplateValidationError,
  type TemplateValidationResult,
} from "./types.js";

const KEY_REGEX = /^[a-z_]+$/;
const DEFAULT_VALUE_REGEX = /^[A-Z0-9]*$/;

/**
 * Validates a lab code template string according to the grammar:
 * literal text with tokens `[key=DEFAULT]`; key is `[a-z_]+`, default `[A-Z0-9]*`.
 *
 * Checks for:
 * - Empty template (`EMPTY_TEMPLATE`)
 * - Unclosed brackets (`UNCLOSED_TOKEN`)
 * - Unopened / malformed brackets (`MALFORMED_TOKEN`)
 * - Duplicate token keys (`DUPLICATE_TOKEN <key>`)
 *
 * Returns `{ valid, errors, error?, tokens }`.
 */
export function validateTemplate(text: string | null | undefined): TemplateValidationResult {
  if (text == null || typeof text !== "string" || text.trim().length === 0) {
    const err: TemplateValidationError = {
      code: TEMPLATE_ERROR_CODES.EMPTY_TEMPLATE,
      message: TEMPLATE_ERROR_CODES.EMPTY_TEMPLATE,
    };
    return {
      valid: false,
      errors: [err],
      error: err.message,
      tokens: [],
    };
  }

  const errors: TemplateValidationError[] = [];
  const tokens: ParsedTemplateToken[] = [];
  const seenKeys = new Set<string>();

  let inToken = false;
  let tokenStart = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === "[") {
      if (inToken) {
        // Nested bracket: [a=[b=X]] or [[a=X]]
        errors.push({
          code: TEMPLATE_ERROR_CODES.UNCLOSED_TOKEN,
          message: TEMPLATE_ERROR_CODES.UNCLOSED_TOKEN,
        });
      }
      inToken = true;
      tokenStart = i;
    } else if (ch === "]") {
      if (!inToken) {
        // ] without matching [
        errors.push({
          code: TEMPLATE_ERROR_CODES.MALFORMED_TOKEN,
          message: TEMPLATE_ERROR_CODES.UNOPENED_TOKEN,
        });
      } else {
        const tokenContent = text.slice(tokenStart + 1, i);
        const raw = text.slice(tokenStart, i + 1);
        inToken = false;

        const eqIdx = tokenContent.indexOf("=");
        if (eqIdx === -1) {
          errors.push({
            code: TEMPLATE_ERROR_CODES.MALFORMED_TOKEN,
            message: TEMPLATE_ERROR_CODES.MALFORMED_TOKEN,
          });
        } else {
          const key = tokenContent.slice(0, eqIdx);
          const defaultValue = tokenContent.slice(eqIdx + 1);

          if (!KEY_REGEX.test(key)) {
            errors.push({
              code: TEMPLATE_ERROR_CODES.MALFORMED_TOKEN,
              message: TEMPLATE_ERROR_CODES.INVALID_TOKEN_KEY,
              token: key,
            });
          } else if (!DEFAULT_VALUE_REGEX.test(defaultValue)) {
            errors.push({
              code: TEMPLATE_ERROR_CODES.MALFORMED_TOKEN,
              message: TEMPLATE_ERROR_CODES.INVALID_TOKEN_DEFAULT,
              token: key,
            });
          } else if (seenKeys.has(key)) {
            errors.push({
              code: TEMPLATE_ERROR_CODES.DUPLICATE_TOKEN,
              message: `${TEMPLATE_ERROR_CODES.DUPLICATE_TOKEN} ${key}`,
              token: key,
            });
          } else {
            seenKeys.add(key);
            tokens.push({
              key,
              defaultValue,
              raw,
              startIndex: tokenStart,
              endIndex: i + 1,
            });
          }
        }
      }
    }
  }

  if (inToken) {
    errors.push({
      code: TEMPLATE_ERROR_CODES.UNCLOSED_TOKEN,
      message: TEMPLATE_ERROR_CODES.UNCLOSED_TOKEN,
    });
  }

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    error: errors.length > 0 ? errors[0].message : undefined,
    tokens,
  };
}
