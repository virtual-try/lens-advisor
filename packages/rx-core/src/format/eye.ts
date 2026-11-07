import type { Eye } from "../schemas/prescription.js";
import { formatAxis } from "./axis.js";
import { formatDiopter } from "./diopter.js";

/**
 * Compact one-eye Rx: `SPH`, `SPH/CYLxAXIS`, optional ` ADD ADD`.
 * Cylinder and add are omitted when absent or zero.
 */
export function formatEye(eye: Eye): string {
  let text = formatDiopter(eye.sph);
  if (eye.cyl !== undefined && eye.cyl !== 0) {
    text += `/${formatDiopter(eye.cyl)}`;
    if (eye.axis !== undefined) {
      text += `x${formatAxis(eye.axis)}`;
    }
  }
  if (eye.add !== undefined && eye.add !== 0) {
    text += ` ADD ${formatDiopter(eye.add)}`;
  }
  return text;
}
