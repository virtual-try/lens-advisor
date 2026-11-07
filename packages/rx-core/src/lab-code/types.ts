import type { Lens, OptionGroupKind, OptionValue } from "../types/index.js";

export const TEMPLATE_ERROR_CODES = {
  EMPTY_TEMPLATE: "EMPTY_TEMPLATE",
  UNCLOSED_TOKEN: "UNCLOSED_TOKEN",
  UNOPENED_TOKEN: "UNOPENED_TOKEN",
  MALFORMED_TOKEN: "MALFORMED_TOKEN",
  INVALID_TOKEN_KEY: "INVALID_TOKEN_KEY",
  INVALID_TOKEN_DEFAULT: "INVALID_TOKEN_DEFAULT",
  DUPLICATE_TOKEN: "DUPLICATE_TOKEN",
} as const;

export type TemplateValidationErrorCode =
  (typeof TEMPLATE_ERROR_CODES)[keyof typeof TEMPLATE_ERROR_CODES];

export interface TemplateValidationError {
  code: TemplateValidationErrorCode;
  message: string;
  token?: string;
}

export interface ParsedTemplateToken {
  key: string;
  defaultValue: string;
  raw: string;
  startIndex: number;
  endIndex: number;
}

export interface TemplateValidationResult {
  valid: boolean;
  errors: TemplateValidationError[];
  error?: string;
  tokens: ParsedTemplateToken[];
}

export const LAB_CODE_WARNING_CODES = {
  UNKNOWN_TOKEN: "UNKNOWN_TOKEN",
} as const;

export type LabCodeWarningCode =
  (typeof LAB_CODE_WARNING_CODES)[keyof typeof LAB_CODE_WARNING_CODES];

export interface LabCodeSelectionItem {
  id?: string;
  tokenKey?: string;
  tokenValue?: string;
  key?: string;
  value?: string;
  overrideCode?: string;
  position?: string | number;
  segment?: string | number;
  groupKind?: OptionGroupKind | string;
  optionGroupId?: string;
  label?: string;
}

export type LabCodeSelectionsInput =
  | Array<OptionValue | LabCodeSelectionItem>
  | {
      tokens?: Record<string, string>;
      overrides?: Record<string, string>;
      options?: Array<OptionValue | LabCodeSelectionItem>;
      optionValues?: Array<OptionValue | LabCodeSelectionItem>;
      [key: string]: unknown;
    }
  | Record<string, string>;

export interface CompileLabCodeResult {
  code: string;
  warnings: string[];
}

export type LensOrTemplate = string | Lens | { labCodeTemplate: string };
