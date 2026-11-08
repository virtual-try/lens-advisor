import { describe, expect, it, vi } from "vitest";
import type { CatalogResponse, Prescription, Selection } from "../../../rx-core/src/index.js";
import { addBundle, AddBundleError, getCartEndpoint, refreshCartOrRedirect } from "./add-bundle.js";

const fixtureCatalog: CatalogResponse = {
  lensGroups: [
    {
      id: "group-sv",
      name: "Single Vision",
      position: 0,
      lenses: [
        {
          id: "lens-sv",
          groupId: "group-sv",
          name: "Standard Lens",
          price: { amountMinor: 8000, currency: "USD" },
          shopifyVariantId: "var-lens-sv",
          labCodeTemplate: "SV",
          position: 0,
          limits: {
            sphMin: -800,
            sphMax: 600,
            cylMin: -400,
            cylMax: 0,
            rxTypes: ["SINGLE_VISION", "PROGRESSIVE"],
          },
        },
      ],
    },
  ],
  optionGroups: [
    {
      id: "group-material",
      name: "Material",
      kind: "MATERIAL",
      position: 0,
      values: [
        {
          id: "val-167",
          optionGroupId: "group-material",
          label: "1.67 High Index",
          priceDelta: { amountMinor: 3500, currency: "USD" },
          shopifyVariantId: "var-opt-167",
          position: 0,
        },
      ],
    },
    {
      id: "group-tint",
      name: "Tint",
      kind: "TINT_TYPE",
      position: 1,
      values: [
        {
          id: "val-clear",
          optionGroupId: "group-tint",
          label: "Clear",
          priceDelta: { amountMinor: 0, currency: "USD" },
          // No shopifyVariantId (zero-price option)
          position: 0,
        },
        {
          id: "val-grey",
          optionGroupId: "group-tint",
          label: "Solid Grey",
          priceDelta: { amountMinor: 2000, currency: "USD" },
          shopifyVariantId: "var-opt-grey",
          position: 1,
        },
      ],
    },
  ],
  addOns: [
    {
      id: "addon-case",
      name: "Hard Case",
      price: { amountMinor: 1500, currency: "USD" },
      shopifyVariantId: "var-addon-case",
      position: 0,
    },
  ],
  settings: {
    manualRxEnabled: true,
    rxUploadEnabled: true,
    storeRxInOrder: false,
  },
};

const fixtureSelection: Selection = {
  frameVariantId: "var-frame-harlow",
  rxType: "PROGRESSIVE",
  lensId: "lens-sv",
  optionValueIds: ["val-167", "val-clear"],
  addOnIds: ["addon-case"],
  prescriptionRef: "rx-draft-987",
};

const distinctivePrescription: Prescription = {
  od: { sph: -775, cyl: -125, axis: 90, add: 200 },
  os: { sph: -650, cyl: 0, axis: 0, add: 200 },
  pd: { single: 630 },
};

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function createFakeFetch(
  handler: (call: RecordedCall, callIndex: number) => { status?: number; json?: unknown; throwError?: Error },
) {
  const calls: RecordedCall[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const headers = (init?.headers as Record<string, string>) ?? {};
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const call: RecordedCall = { url, method, headers, body };
    calls.push(call);

    const callIndex = calls.length - 1;
    const result = handler(call, callIndex);

    if (result.throwError) {
      throw result.throwError;
    }

    const status = result.status ?? 200;
    return new Response(JSON.stringify(result.json ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });

  return { fetchFn, calls };
}

describe("Spec 29 — addBundle (packages/configurator/src/cart)", () => {
  it("Row 1: all 200 -> add frame then add [lens, 1.67, case] with parent_id = frame key", async () => {
    const { fetchFn, calls } = createFakeFetch((call, callIndex) => {
      if (callIndex === 0) {
        // Frame add
        return {
          status: 200,
          json: {
            items: [
              {
                id: "var-frame-harlow",
                key: "445566:abcdef12345",
                quantity: 1,
              },
            ],
          },
        };
      }
      if (callIndex === 1) {
        // Child add
        return {
          status: 200,
          json: {
            items: [
              { id: "var-lens-sv", key: "child-key-1" },
              { id: "var-opt-167", key: "child-key-2" },
              { id: "var-addon-case", key: "child-key-3" },
            ],
          },
        };
      }
      return { status: 404 };
    });

    const result = await addBundle({
      selection: fixtureSelection,
      catalog: fixtureCatalog,
      fetch: fetchFn as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(result.frameLineKey).toBe("445566:abcdef12345");
    expect(calls).toHaveLength(2);

    // Call 1: Frame POST
    const frameCall = calls[0];
    expect(frameCall.url).toBe("/cart/add.js");
    expect(frameCall.method).toBe("POST");
    const frameItems = frameCall.body.items as Array<Record<string, unknown>>;
    expect(frameItems).toHaveLength(1);
    expect(frameItems[0].id).toBe("var-frame-harlow");
    expect((frameItems[0].properties as Record<string, string>)._bundle_role).toBe("frame");
    expect(typeof (frameItems[0].properties as Record<string, string>)._bundle_id).toBe("string");

    // Call 2: Children POST
    const childCall = calls[1];
    expect(childCall.url).toBe("/cart/add.js");
    expect(childCall.method).toBe("POST");
    const childItems = childCall.body.items as Array<Record<string, unknown>>;
    expect(childItems).toHaveLength(3); // lens, 1.67, case

    // Self-check 1: The child POST sends parent_id as the frame line key from the response, not the variant id
    for (const child of childItems) {
      expect(child.parent_id).toBe("445566:abcdef12345");
      expect(child.parent_id).not.toBe("var-frame-harlow");
    }

    // Lens item checks
    const lensItem = childItems.find((i) => i.id === "var-lens-sv");
    expect(lensItem).toBeDefined();
    const lensProps = lensItem!.properties as Record<string, string>;
    expect(lensProps._bundle_role).toBe("lens");
    expect(lensProps._item_id).toBe("lens-sv");
    expect(lensProps._option_ids).toBe(JSON.stringify(["val-167", "val-clear"]));
    expect(lensProps._addon_ids).toBe(JSON.stringify(["addon-case"]));
    expect(lensProps._rx_ref).toBe("rx-draft-987");

    // Option item checks (1.67)
    const optItem = childItems.find((i) => i.id === "var-opt-167");
    expect(optItem).toBeDefined();
    const optProps = optItem!.properties as Record<string, string>;
    expect(optProps._bundle_role).toBe("option");
    expect(optProps._item_id).toBe("val-167");

    // Addon item checks (case)
    const addonItem = childItems.find((i) => i.id === "var-addon-case");
    expect(addonItem).toBeDefined();
    const addonProps = addonItem!.properties as Record<string, string>;
    expect(addonProps._bundle_role).toBe("addon");
    expect(addonProps._item_id).toBe("addon-case");
  });

  it("Row 2: tint 'Clear' (delta 0, no variant) chosen -> no line for it; its id is in the lens line _option_ids", async () => {
    const { fetchFn, calls } = createFakeFetch((_call, callIndex) => {
      if (callIndex === 0) {
        return {
          status: 200,
          json: { key: "frame-key-row-2" },
        };
      }
      return {
        status: 200,
        json: { items: [] },
      };
    });

    // Selection has val-clear
    await addBundle({
      selection: {
        ...fixtureSelection,
        optionValueIds: ["val-clear"], // ONLY clear tint (no variant)
        addOnIds: [],
      },
      catalog: fixtureCatalog,
      fetch: fetchFn as unknown as typeof fetch,
    });

    expect(calls).toHaveLength(2);
    const childItems = calls[1].body.items as Array<Record<string, unknown>>;
    // Only 1 child line: the lens itself (no line for val-clear)
    expect(childItems).toHaveLength(1);
    expect(childItems[0].id).toBe("var-lens-sv");
    // But val-clear ID is recorded in _option_ids on the lens line
    const lensProps = childItems[0].properties as Record<string, string>;
    expect(lensProps._option_ids).toBe(JSON.stringify(["val-clear"]));
  });

  it("Row 3: child add returns 422 (sold out) -> /cart/change.js frame qty 0; rollback runs (Self-check 2)", async () => {
    const { fetchFn, calls } = createFakeFetch((_call, callIndex) => {
      if (callIndex === 0) {
        return {
          status: 200,
          json: { key: "frame-line-to-rollback" },
        };
      }
      if (callIndex === 1) {
        // Child add fails with 422
        return {
          status: 422,
          json: { message: "Item is sold out" },
        };
      }
      if (callIndex === 2) {
        // Rollback /cart/change.js
        return {
          status: 200,
          json: { items: [] },
        };
      }
      return { status: 500 };
    });

    let thrownError: unknown;
    try {
      await addBundle({
        selection: fixtureSelection,
        catalog: fixtureCatalog,
        fetch: fetchFn as unknown as typeof fetch,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AddBundleError);
    const bundleErr = thrownError as AddBundleError;
    expect(bundleErr.code).toBe("CHILD_ADD_FAILED");
    expect(bundleErr.status).toBe(422);
    expect(bundleErr.rolledBack).toBe(true);
    expect(bundleErr.message).toBe("Couldn't add your lenses");

    // Assert exact 3 calls in order:
    expect(calls).toHaveLength(3);
    // 1. POST /cart/add.js (frame)
    expect(calls[0].url).toBe("/cart/add.js");
    expect(calls[0].method).toBe("POST");
    // 2. POST /cart/add.js (children)
    expect(calls[1].url).toBe("/cart/add.js");
    expect(calls[1].method).toBe("POST");
    // 3. POST /cart/change.js (rollback with frame qty 0)
    expect(calls[2].url).toBe("/cart/change.js");
    expect(calls[2].method).toBe("POST");
    expect(calls[2].body).toEqual({
      id: "frame-line-to-rollback",
      quantity: 0,
    });
  });

  it("Self-check 2: rollback runs on every child failure path, including a network throw", async () => {
    const { fetchFn, calls } = createFakeFetch((_call, callIndex) => {
      if (callIndex === 0) {
        return {
          status: 200,
          json: { key: "frame-net-fail-key" },
        };
      }
      if (callIndex === 1) {
        // Child add throws network error
        return {
          throwError: new TypeError("Network failure: Failed to fetch"),
        };
      }
      if (callIndex === 2) {
        // Rollback change.js
        return { status: 200, json: {} };
      }
      return { status: 500 };
    });

    let thrownError: unknown;
    try {
      await addBundle({
        selection: fixtureSelection,
        catalog: fixtureCatalog,
        fetch: fetchFn as unknown as typeof fetch,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AddBundleError);
    const bundleErr = thrownError as AddBundleError;
    expect(bundleErr.rolledBack).toBe(true);
    expect(bundleErr.code).toBe("NETWORK_ERROR");

    // Assert rollback call happened
    expect(calls).toHaveLength(3);
    expect(calls[2].url).toBe("/cart/change.js");
    expect(calls[2].body).toEqual({
      id: "frame-net-fail-key",
      quantity: 0,
    });
  });

  it("R1-F1: rollbackFrame fails (non-OK 500) -> rolledBack is false and distinct ROLLBACK_FAILED surfaced", async () => {
    const { fetchFn, calls } = createFakeFetch((_call, callIndex) => {
      if (callIndex === 0) {
        return { status: 200, json: { key: "frame-key-fail-change" } };
      }
      if (callIndex === 1) {
        return { status: 422, json: { message: "Lens out of stock" } };
      }
      if (callIndex === 2) {
        // change.js fails with 500
        return { status: 500, json: { message: "Internal server error" } };
      }
      return { status: 500 };
    });

    let thrownError: unknown;
    try {
      await addBundle({
        selection: fixtureSelection,
        catalog: fixtureCatalog,
        fetch: fetchFn as unknown as typeof fetch,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AddBundleError);
    const bundleErr = thrownError as AddBundleError;
    expect(bundleErr.code).toBe("ROLLBACK_FAILED");
    expect(bundleErr.rolledBack).toBe(false);
    expect(bundleErr.message).toContain("frame may still be in your cart");
    expect(calls).toHaveLength(3);
  });

  it("R1-F1: rollbackFrame fails (network throw) -> rolledBack is false and ROLLBACK_FAILED surfaced", async () => {
    const { fetchFn, calls } = createFakeFetch((_call, callIndex) => {
      if (callIndex === 0) {
        return { status: 200, json: { key: "frame-key-throw-change" } };
      }
      if (callIndex === 1) {
        return { throwError: new TypeError("Network offline") };
      }
      if (callIndex === 2) {
        return { throwError: new TypeError("Rollback network throw") };
      }
      return { status: 500 };
    });

    let thrownError: unknown;
    try {
      await addBundle({
        selection: fixtureSelection,
        catalog: fixtureCatalog,
        fetch: fetchFn as unknown as typeof fetch,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AddBundleError);
    const bundleErr = thrownError as AddBundleError;
    expect(bundleErr.code).toBe("ROLLBACK_FAILED");
    expect(bundleErr.rolledBack).toBe(false);
    expect(bundleErr.message).toContain("frame may still be in your cart");
    expect(calls).toHaveLength(3);
  });

  it("R1-F2: FRAME_RESPONSE_INVALID after 200 -> re-reads /cart.js and rolls back newest frame line", async () => {
    let callCount = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      callCount++;

      if (callCount === 1) {
        // Frame add returns 200 but invalid JSON
        return new Response("INVALID_JSON", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (callCount === 2) {
        // Re-read /cart.js
        expect(url).toBe("/cart.js");
        expect(method).toBe("GET");
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "var-frame-harlow",
                key: "line-key-from-cart-js",
                properties: { _bundle_id: "test-bundle-id", _bundle_role: "frame" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (callCount === 3) {
        // Rollback /cart/change.js
        expect(url).toBe("/cart/change.js");
        expect(method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body).toEqual({ id: "line-key-from-cart-js", quantity: 0 });
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    });

    let thrownError: unknown;
    try {
      await addBundle({
        selection: fixtureSelection,
        catalog: fixtureCatalog,
        bundleId: "test-bundle-id",
        fetch: fetchFn as unknown as typeof fetch,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AddBundleError);
    const bundleErr = thrownError as AddBundleError;
    expect(bundleErr.code).toBe("FRAME_RESPONSE_INVALID");
    expect(bundleErr.rolledBack).toBe(true);
    expect(callCount).toBe(3);
  });

  it("R1-F2: FRAME_KEY_MISSING after 200 -> re-reads /cart.js and rolls back newest frame line", async () => {
    let callCount = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      callCount++;

      if (callCount === 1) {
        // Frame add returns 200 with no key
        return new Response(JSON.stringify({ items: [{ id: "var-frame-harlow" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (callCount === 2) {
        // Re-read /cart.js
        expect(url).toBe("/cart.js");
        expect(method).toBe("GET");
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "var-frame-harlow",
                key: "key-from-cart-js-missing",
                properties: { _bundle_id: "bundle-key-missing", _bundle_role: "frame" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (callCount === 3) {
        // Rollback
        expect(url).toBe("/cart/change.js");
        const body = JSON.parse(init?.body as string);
        expect(body).toEqual({ id: "key-from-cart-js-missing", quantity: 0 });
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    let thrownError: unknown;
    try {
      await addBundle({
        selection: fixtureSelection,
        catalog: fixtureCatalog,
        bundleId: "bundle-key-missing",
        fetch: fetchFn as unknown as typeof fetch,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AddBundleError);
    const bundleErr = thrownError as AddBundleError;
    expect(bundleErr.code).toBe("FRAME_KEY_MISSING");
    expect(bundleErr.rolledBack).toBe(true);
    expect(callCount).toBe(3);
  });

  it("R1-F2: UNKNOWN_LENS rolls back frame and throws UNKNOWN_LENS with rolledBack: true", async () => {
    const { fetchFn, calls } = createFakeFetch((_call, callIndex) => {
      if (callIndex === 0) {
        return { status: 200, json: { key: "frame-key-unknown-lens" } };
      }
      if (callIndex === 1) {
        // Rollback change.js
        return { status: 200, json: { items: [] } };
      }
      return { status: 500 };
    });

    let thrownError: unknown;
    try {
      await addBundle({
        selection: {
          ...fixtureSelection,
          lensId: "nonexistent-lens-id",
        },
        catalog: fixtureCatalog,
        fetch: fetchFn as unknown as typeof fetch,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AddBundleError);
    const bundleErr = thrownError as AddBundleError;
    expect(bundleErr.code).toBe("UNKNOWN_LENS");
    expect(bundleErr.rolledBack).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe("/cart/change.js");
    expect(calls[1].body).toEqual({
      id: "frame-key-unknown-lens",
      quantity: 0,
    });
  });

  it("R1-F3: NON_PRESCRIPTION rxType writes no _rx_* properties, even with stale state.prescription", async () => {
    const { fetchFn, calls } = createFakeFetch((_call, callIndex) => {
      if (callIndex === 0) return { status: 200, json: { key: "frame-non-rx-key" } };
      return { status: 200, json: { items: [] } };
    });

    const catalogWithSettingOn: CatalogResponse = {
      ...fixtureCatalog,
      settings: {
        ...fixtureCatalog.settings,
        storeRxInOrder: true,
      },
    };

    await addBundle({
      selection: {
        ...fixtureSelection,
        rxType: "NON_PRESCRIPTION",
        prescriptionRef: "stale-rx-ref-999",
      },
      catalog: catalogWithSettingOn,
      prescription: distinctivePrescription,
      storeRxInOrder: true,
      fetch: fetchFn as unknown as typeof fetch,
    });

    expect(calls).toHaveLength(2);
    const childItems = calls[1].body.items as Array<Record<string, unknown>>;
    const lensItem = childItems.find((i) => i.id === "var-lens-sv")!;
    const lensProps = lensItem.properties as Record<string, string>;

    expect(lensProps._rx_od).toBeUndefined();
    expect(lensProps._rx_os).toBeUndefined();
    expect(lensProps._rx_pd).toBeUndefined();
    expect(lensProps._rx_ref).toBeUndefined();
    expect(lensProps.Prescription).toBeUndefined();

    // Verify distinctive Rx numbers are nowhere in the request body
    const bodyStr = JSON.stringify(calls);
    expect(bodyStr).not.toContain("-7.75");
    expect(bodyStr).not.toContain("-6.50");
    expect(bodyStr).not.toContain("stale-rx-ref-999");
  });

  it("Row 4 (INV-3): storeRxInOrder off -> no property value contains a formatted Rx number", async () => {
    const { fetchFn, calls } = createFakeFetch((_call, callIndex) => {
      if (callIndex === 0) return { status: 200, json: { key: "frame-inv3-off" } };
      return { status: 200, json: { items: [] } };
    });

    const catalogWithSettingOff: CatalogResponse = {
      ...fixtureCatalog,
      settings: {
        ...fixtureCatalog.settings,
        storeRxInOrder: false,
      },
    };

    await addBundle({
      selection: fixtureSelection,
      catalog: catalogWithSettingOff,
      prescription: distinctivePrescription,
      storeRxInOrder: false,
      fetch: fetchFn as unknown as typeof fetch,
    });

    const serializedPayloads = JSON.stringify(calls);

    // Assert distinctive Rx numbers do not appear in any property or call body
    expect(serializedPayloads).not.toContain("-7.75");
    expect(serializedPayloads).not.toContain("7.75");
    expect(serializedPayloads).not.toContain("-1.25");
    expect(serializedPayloads).not.toContain("1.25");
    expect(serializedPayloads).not.toContain("-6.50");
    expect(serializedPayloads).not.toContain("6.50");

    // Only opaque rxRef and Prescription on file
    expect(serializedPayloads).toContain("rx-draft-987");
    expect(serializedPayloads).toContain("Prescription on file");
  });

  it("Row 5 (INV-3): storeRxInOrder on -> _rx_od/_rx_os/_rx_pd present on the lens line only", async () => {
    const { fetchFn, calls } = createFakeFetch((_call, callIndex) => {
      if (callIndex === 0) return { status: 200, json: { key: "frame-inv3-on" } };
      return { status: 200, json: { items: [] } };
    });

    const catalogWithSettingOn: CatalogResponse = {
      ...fixtureCatalog,
      settings: {
        ...fixtureCatalog.settings,
        storeRxInOrder: true,
      },
    };

    await addBundle({
      selection: fixtureSelection,
      catalog: catalogWithSettingOn,
      prescription: distinctivePrescription,
      storeRxInOrder: true,
      fetch: fetchFn as unknown as typeof fetch,
    });

    expect(calls).toHaveLength(2);
    const childItems = calls[1].body.items as Array<Record<string, unknown>>;
    const lensItem = childItems.find((i) => i.id === "var-lens-sv");
    expect(lensItem).toBeDefined();

    const lensProps = lensItem!.properties as Record<string, string>;
    expect(lensProps._rx_od).toBe("-7.75/-1.25x090 ADD +2.00");
    expect(lensProps._rx_os).toBe("-6.50 ADD +2.00");
    expect(lensProps._rx_pd).toBe("63.0");
    // Visible Prescription key is omitted when storeRxInOrder is on
    expect(lensProps.Prescription).toBeUndefined();

    // Check option and addon lines have NO rx properties
    const optItem = childItems.find((i) => i.id === "var-opt-167")!;
    const optProps = optItem.properties as Record<string, string>;
    expect(optProps._rx_od).toBeUndefined();
    expect(optProps._rx_os).toBeUndefined();
    expect(optProps._rx_pd).toBeUndefined();

    const addonItem = childItems.find((i) => i.id === "var-addon-case")!;
    const addonProps = addonItem.properties as Record<string, string>;
    expect(addonProps._rx_od).toBeUndefined();
    expect(addonProps._rx_os).toBeUndefined();
    expect(addonProps._rx_pd).toBeUndefined();
  });

  it("handles window.Shopify.routes.root prefix for cart URLs", async () => {
    const { fetchFn, calls } = createFakeFetch((_call, callIndex) => {
      if (callIndex === 0) return { status: 200, json: { key: "frame-prefix-key" } };
      return { status: 200, json: { items: [] } };
    });

    await addBundle({
      selection: fixtureSelection,
      catalog: fixtureCatalog,
      fetch: fetchFn as unknown as typeof fetch,
      routesRoot: "/en-ca/",
    });

    expect(calls[0].url).toBe("/en-ca/cart/add.js");
    expect(calls[1].url).toBe("/en-ca/cart/add.js");
  });

  it("getCartEndpoint formats relative paths and roots correctly", () => {
    expect(getCartEndpoint("/cart/add.js")).toBe("/cart/add.js");
    expect(getCartEndpoint("cart/add.js", "/")).toBe("/cart/add.js");
    expect(getCartEndpoint("/cart/add.js", "/de/")).toBe("/de/cart/add.js");
    expect(getCartEndpoint("/cart/change.js", "/fr")).toBe("/fr/cart/change.js");
  });

  it("R1-F6: refreshCartOrRedirect navigates to /cart reliably, unless explicit theme hook is configured", () => {
    const redirectFn = vi.fn();
    const eventSpy = vi.fn();
    document.addEventListener("cart:refresh", eventSpy);
    document.addEventListener("cart:updated", eventSpy);

    // Case 1: default redirects to /cart, does not fire invented events even if drawer DOM exists
    const drawerEl = document.createElement("cart-drawer");
    document.body.appendChild(drawerEl);

    refreshCartOrRedirect({ routesRoot: "/en", redirectFn });
    expect(redirectFn).toHaveBeenCalledWith("/en/cart");
    expect(eventSpy).not.toHaveBeenCalled();

    drawerEl.remove();

    // Case 2: explicit hook in options is invoked, redirect is skipped
    const hookFn = vi.fn();
    const redirectFn2 = vi.fn();
    refreshCartOrRedirect({ onCartUpdate: hookFn, redirectFn: redirectFn2 });
    expect(hookFn).toHaveBeenCalledTimes(1);
    expect(redirectFn2).not.toHaveBeenCalled();

    // Case 3: explicit hook on window.LensAdvisor.onCartUpdate is invoked
    const globalHook = vi.fn();
    (window as unknown as { LensAdvisor?: { onCartUpdate?: () => void } }).LensAdvisor = {
      onCartUpdate: globalHook,
    };
    const redirectFn3 = vi.fn();
    refreshCartOrRedirect({ redirectFn: redirectFn3 });
    expect(globalHook).toHaveBeenCalledTimes(1);
    expect(redirectFn3).not.toHaveBeenCalled();
    delete (window as unknown as { LensAdvisor?: unknown }).LensAdvisor;

    document.removeEventListener("cart:refresh", eventSpy);
    document.removeEventListener("cart:updated", eventSpy);
  });
});
