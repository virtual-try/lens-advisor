/**
 * Node 22.12 does not strip types. `scripts/build.mjs` imports `vite.entries.mjs`
 * directly so the package build never loads this file.
 */
import { assetsOutDir, entryConfigs, listEntryNames } from "./vite.entries.mjs";

export { assetsOutDir, entryConfigs, listEntryNames };

export default entryConfigs();
