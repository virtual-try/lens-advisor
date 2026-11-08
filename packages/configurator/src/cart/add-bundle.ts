import type {
  CatalogResponse,
  Lens,
  OptionValue,
  Prescription,
  Selection,
} from "../../../rx-core/src/index.js";
import { buildBundleLineProperties } from "../../../rx-core/src/cart/bundle-properties.js";

export interface AddBundleOptions {
  prescription?: Prescription | null;
  bundleId?: string;
  storeRxInOrder?: boolean;
  fetch?: typeof fetch;
  routesRoot?: string;
}

export interface AddBundleInput extends AddBundleOptions {
  selection: Selection;
  catalog: CatalogResponse;
}

export interface AddBundleResult {
  ok: true;
  bundleId: string;
  frameLineKey: string;
  itemCount: number;
}

export class AddBundleError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly rolledBack: boolean;
  readonly frameLineKey?: string;

  constructor(options: {
    code: string;
    message?: string;
    status?: number;
    rolledBack?: boolean;
    frameLineKey?: string;
    cause?: unknown;
  }) {
    super(options.message ?? "Couldn't add your lenses");
    this.name = "AddBundleError";
    this.code = options.code;
    this.status = options.status;
    this.rolledBack = options.rolledBack ?? false;
    this.frameLineKey = options.frameLineKey;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function getCartEndpoint(path: string, routesRoot?: string): string {
  let root = routesRoot;
  if (!root && typeof window !== "undefined") {
    const shopify = (window as unknown as { Shopify?: { routes?: { root?: string } } }).Shopify;
    root = shopify?.routes?.root;
  }
  const cleanRoot = (root || "/").replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanRoot}${cleanPath}`;
}

export function refreshCartOrRedirect(options?: {
  routesRoot?: string;
  redirectFn?: (url: string) => void;
}): void {
  if (typeof window === "undefined") {
    return;
  }
  const cartUrl = getCartEndpoint("/cart", options?.routesRoot);

  const hasThemeDrawer =
    typeof document !== "undefined" &&
    Boolean(
      document.querySelector(
        "cart-drawer, [data-cart-drawer], cart-notification, .cart-drawer, #cart-drawer"
      ) ||
      (window as unknown as { theme?: { cart?: unknown } }).theme?.cart ||
      (window as unknown as { Shopify?: { onCartUpdate?: unknown } }).Shopify?.onCartUpdate
    );

  let eventDispatched = false;
  if (typeof document !== "undefined") {
    const refreshEvent = new CustomEvent("cart:refresh", {
      bubbles: true,
      cancelable: true,
    });
    const updateEvent = new CustomEvent("cart:updated", {
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(refreshEvent);
    document.dispatchEvent(updateEvent);

    if (refreshEvent.defaultPrevented || updateEvent.defaultPrevented) {
      eventDispatched = true;
    }
  }

  if (!hasThemeDrawer && !eventDispatched) {
    if (options?.redirectFn) {
      options.redirectFn(cartUrl);
    } else {
      try {
        window.location.href = cartUrl;
      } catch {
        // In environments like jsdom, navigation is not implemented
      }
    }
  }
}

function findLens(catalog: CatalogResponse, lensId: string): Lens | undefined {
  for (const group of catalog.lensGroups ?? []) {
    for (const lens of group.lenses ?? []) {
      if (lens.id === lensId) {
        return lens;
      }
    }
  }
  return undefined;
}

function findOptionValue(catalog: CatalogResponse, optionValueId: string): OptionValue | undefined {
  for (const group of catalog.optionGroups ?? []) {
    for (const val of group.values ?? []) {
      if (val.id === optionValueId) {
        return val;
      }
    }
  }
  return undefined;
}

async function rollbackFrame(
  fetchFn: typeof fetch,
  changeUrl: string,
  frameLineKey: string,
): Promise<void> {
  try {
    await fetchFn(changeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        id: frameLineKey,
        quantity: 0,
      }),
    });
  } catch {
    // Swallow rollback network errors so original error is propagated
  }
}

export async function addBundle(
  inputOrSelection: AddBundleInput | Selection,
  catalogArg?: CatalogResponse,
  optionsArg?: AddBundleOptions,
): Promise<AddBundleResult> {
  const isInputObj =
    typeof inputOrSelection === "object" &&
    inputOrSelection !== null &&
    "selection" in inputOrSelection &&
    "catalog" in inputOrSelection;

  const selection = isInputObj
    ? (inputOrSelection as AddBundleInput).selection
    : (inputOrSelection as Selection);
  const catalog = isInputObj
    ? (inputOrSelection as AddBundleInput).catalog
    : catalogArg!;
  const options = isInputObj
    ? (inputOrSelection as AddBundleInput)
    : optionsArg ?? {};

  if (!selection || !selection.frameVariantId) {
    throw new AddBundleError({
      code: "MISSING_FRAME_VARIANT",
      message: "Frame variant id is required",
      rolledBack: false,
    });
  }

  const bundleId =
    options.bundleId ||
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

  const storeRxInOrder =
    options.storeRxInOrder ?? catalog.settings?.storeRxInOrder ?? false;

  const fetchFn =
    options.fetch ??
    (typeof window !== "undefined" && typeof window.fetch === "function"
      ? window.fetch.bind(window)
      : fetch);

  const addUrl = getCartEndpoint("/cart/add.js", options.routesRoot);
  const changeUrl = getCartEndpoint("/cart/change.js", options.routesRoot);

  // 1. Frame line item properties
  const frameProperties = buildBundleLineProperties({
    role: "frame",
    bundleId,
    storeRxInOrder,
  });

  // 2. Add frame line to cart
  let frameResponse: Response;
  try {
    frameResponse = await fetchFn(addUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            id: selection.frameVariantId,
            quantity: 1,
            properties: frameProperties,
          },
        ],
      }),
    });
  } catch (err) {
    throw new AddBundleError({
      code: "FRAME_ADD_FAILED",
      message: "Couldn't add your frame",
      rolledBack: false,
      cause: err,
    });
  }

  if (!frameResponse.ok) {
    throw new AddBundleError({
      code: "FRAME_ADD_FAILED",
      message: "Couldn't add your frame",
      status: frameResponse.status,
      rolledBack: false,
    });
  }

  let frameData: { key?: string; items?: Array<{ key?: string }> };
  try {
    frameData = await frameResponse.json();
  } catch (err) {
    throw new AddBundleError({
      code: "FRAME_RESPONSE_INVALID",
      message: "Invalid response adding frame",
      rolledBack: false,
      cause: err,
    });
  }

  const frameLineKey = frameData.key ?? frameData.items?.[0]?.key;
  if (!frameLineKey) {
    throw new AddBundleError({
      code: "FRAME_KEY_MISSING",
      message: "Frame line key missing from response",
      rolledBack: false,
    });
  }

  // 3. Prepare child items with parent_id = frameLineKey
  const childItems: Array<{
    id: string;
    quantity: number;
    parent_id: string;
    properties: Record<string, string>;
  }> = [];

  // Lens child (when selection.lensId is present)
  if (selection.lensId) {
    const lens = findLens(catalog, selection.lensId);
    if (!lens) {
      await rollbackFrame(fetchFn, changeUrl, frameLineKey);
      throw new AddBundleError({
        code: "UNKNOWN_LENS",
        message: `Lens not found: ${selection.lensId}`,
        rolledBack: true,
        frameLineKey,
      });
    }

    const lensProperties = buildBundleLineProperties({
      role: "lens",
      bundleId,
      itemId: lens.id,
      optionIds: selection.optionValueIds,
      addonIds: selection.addOnIds,
      rxRef: selection.prescriptionRef,
      storeRxInOrder,
      prescription: options.prescription ?? undefined,
    });

    childItems.push({
      id: lens.shopifyVariantId,
      quantity: 1,
      parent_id: frameLineKey,
      properties: lensProperties,
    });
  }

  // Option children: each option value with a variant
  for (const valId of selection.optionValueIds) {
    const val = findOptionValue(catalog, valId);
    if (val && val.shopifyVariantId) {
      const optionProperties = buildBundleLineProperties({
        role: "option",
        bundleId,
        itemId: val.id,
        storeRxInOrder,
      });
      childItems.push({
        id: val.shopifyVariantId,
        quantity: 1,
        parent_id: frameLineKey,
        properties: optionProperties,
      });
    }
  }

  // Add-on children: each add-on with a variant
  for (const addOnId of selection.addOnIds) {
    const addOn = catalog.addOns.find((a) => a.id === addOnId);
    if (addOn && addOn.shopifyVariantId) {
      const addOnProperties = buildBundleLineProperties({
        role: "addon",
        bundleId,
        itemId: addOn.id,
        storeRxInOrder,
      });
      childItems.push({
        id: addOn.shopifyVariantId,
        quantity: 1,
        parent_id: frameLineKey,
        properties: addOnProperties,
      });
    }
  }

  // 4. POST children if any
  if (childItems.length > 0) {
    let childResponse: Response | undefined;
    let childError: unknown;
    try {
      childResponse = await fetchFn(addUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          items: childItems,
        }),
      });
    } catch (err) {
      childError = err;
    }

    if (!childResponse || !childResponse.ok) {
      // Rollback frame
      await rollbackFrame(fetchFn, changeUrl, frameLineKey);

      throw new AddBundleError({
        code: "CHILD_ADD_FAILED",
        message: "Couldn't add your lenses",
        status: childResponse?.status,
        rolledBack: true,
        frameLineKey,
        cause: childError,
      });
    }
  }

  return {
    ok: true,
    bundleId,
    frameLineKey,
    itemCount: 1 + childItems.length,
  };
}
