import type {
  Diopter,
  Lens,
  RxType,
} from "../types/index.js";

export type LimitExceededCode =
  | "RX_TYPE_NOT_SUPPORTED"
  | "SPH_BELOW_MIN"
  | "SPH_ABOVE_MAX"
  | "CYL_OUT_OF_RANGE"
  | "ADD_OUT_OF_RANGE";

export type LimitExceededEye = "OD" | "OS";

export type LimitExceededField = "rxType" | "sph" | "cyl" | "add";

export interface RxTypeLimitReason {
  code: "RX_TYPE_NOT_SUPPORTED";
  field: "rxType";
  eye?: undefined;
  value: RxType;
  limit: readonly RxType[];
}

export interface DiopterLimitReason {
  code:
    | "SPH_BELOW_MIN"
    | "SPH_ABOVE_MAX"
    | "CYL_OUT_OF_RANGE"
    | "ADD_OUT_OF_RANGE";
  field: "sph" | "cyl" | "add";
  eye: LimitExceededEye;
  value: Diopter;
  limit: Diopter;
}

export type LimitExceededReason = RxTypeLimitReason | DiopterLimitReason;

export type CheckLensResult =
  | { available: true; reason?: never }
  | { available: false; reason: LimitExceededReason };

export interface FilteredLens {
  lens: Lens;
  result: CheckLensResult;
  available: boolean;
  reason?: LimitExceededReason;
}
