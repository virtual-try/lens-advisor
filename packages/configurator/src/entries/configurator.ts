/** Tag spec 16 fills. This entry only registers the element so the script is not a no-op. */
export const LENS_CONFIGURATOR_TAG = "lens-configurator";

class LensConfiguratorElement extends HTMLElement {}

if (!customElements.get(LENS_CONFIGURATOR_TAG)) {
  customElements.define(LENS_CONFIGURATOR_TAG, LensConfiguratorElement);
}
