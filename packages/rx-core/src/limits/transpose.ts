import type { Axis, Diopter, Eye, Prescription } from "../types/index.js";

/**
 * Transpose an eye's prescription between plus and minus cylinder form:
 * SPH' = SPH + CYL
 * CYL' = -CYL
 * AXIS' = AXIS <= 90 ? AXIS + 90 : AXIS - 90 (kept in 1–180).
 *
 * Plano CYL (0) or absent CYL is not transposed (returns input unchanged).
 */
export function transposeEye(eye: Eye): Eye {
  if (eye.cyl === undefined || eye.cyl === 0) {
    return { ...eye };
  }

  const sph = (eye.sph + eye.cyl) as Diopter;
  const negatedCyl = -eye.cyl;
  const cyl = (negatedCyl === 0 ? 0 : negatedCyl) as Diopter;

  let axis: Axis | undefined = eye.axis;
  if (axis !== undefined) {
    const transposedAxis = axis <= 90 ? axis + 90 : axis - 90;
    axis = transposedAxis as Axis;
  }

  return {
    ...eye,
    sph,
    cyl,
    ...(axis !== undefined ? { axis } : {}),
  };
}

/**
 * Transpose an eye or full prescription between plus and minus cylinder form.
 * Transposing twice returns the original (involution).
 */
export function transpose(eye: Eye): Eye;
export function transpose(rx: Prescription): Prescription;
export function transpose(target: Eye | Prescription): Eye | Prescription {
  if ("sph" in target) {
    return transposeEye(target);
  }
  return {
    ...target,
    od: transposeEye(target.od),
    os: transposeEye(target.os),
  };
}
