/**
 * Closed error codes for pricing. `UNKNOWN_ITEM` messages are
 * `${code} ${itemId}` so the id is part of the error the caller sees.
 */
export const PRICING_ERROR_CODES = {
  CURRENCY_MISMATCH: "CURRENCY_MISMATCH",
  NEGATIVE_DELTA: "NEGATIVE_DELTA",
  UNKNOWN_ITEM: "UNKNOWN_ITEM",
  MONEY_FORMAT: "MONEY_FORMAT",
  MONEY_PRECISION: "MONEY_PRECISION",
} as const;

export type PricingErrorCode =
  (typeof PRICING_ERROR_CODES)[keyof typeof PRICING_ERROR_CODES];

export class PricingError extends Error {
  readonly code: PricingErrorCode;
  readonly itemId?: string;

  constructor(code: PricingErrorCode, itemId?: string) {
    super(itemId === undefined ? code : `${code} ${itemId}`);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "PricingError";
    this.code = code;
    if (itemId !== undefined) {
      this.itemId = itemId;
    }
  }
}
