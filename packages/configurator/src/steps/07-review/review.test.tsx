import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import type { CatalogResponse, Prescription, Selection } from "../../../../rx-core/src/index.js";
import type { ApiClient } from "../../shared/api";
import type { ProductData } from "../../shared/types";
import type { ConfiguratorState } from "../../shell/types";
import { ReviewStep } from "./ReviewStep";
import { reviewStep, isReviewStepApplicable, isReviewStepComplete } from "./index";
import { strings } from "./strings";

const mockApi = {} as ApiClient;

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

const fixtureProduct: ProductData = {
  id: "prod-1",
  productId: "prod-1",
  title: "Harlow",
  priceMinor: 12000,
  currency: "USD",
  variants: [
    {
      id: "var-frame-harlow",
      priceMinor: 12000,
      title: "Tortoise",
    },
  ],
};

const fixtureSelection: Selection = {
  frameVariantId: "var-frame-harlow",
  rxType: "PROGRESSIVE",
  lensId: "lens-sv",
  optionValueIds: ["val-167", "val-clear"],
  addOnIds: ["addon-case"],
  prescriptionRef: "rx-ref-123",
};

const distinctivePrescription: Prescription = {
  od: { sph: -775, cyl: -125, axis: 90, add: 200 },
  os: { sph: -650, cyl: 0, axis: 0, add: 200 },
  pd: { single: 630 },
};

function createReviewState(overrides?: Partial<ConfiguratorState>): ConfiguratorState {
  return {
    stepIndex: 6,
    rxType: "PROGRESSIVE",
    prescription: distinctivePrescription,
    prescriptionRef: "rx-ref-123",
    catalog: fixtureCatalog,
    selection: fixtureSelection,
    status: "ready",
    error: null,
    isOpen: true,
    ...overrides,
  };
}

describe("Spec 29 — ReviewStep (packages/configurator/src/steps/07-review)", () => {
  it("renders all choices and step title correctly", () => {
    const state = createReviewState();
    const dispatch = vi.fn();

    render(
      <ReviewStep
        state={state}
        dispatch={dispatch}
        api={mockApi}
        product={fixtureProduct}
      />,
    );

    // Title & reassurance
    expect(screen.getByText(strings.stepTitle)).toBeTruthy();
    expect(screen.getByText(strings.stepDescription)).toBeTruthy();
    expect(screen.getByText(strings.reassurance)).toBeTruthy();

    // Frame item
    expect(screen.getByText("Harlow")).toBeTruthy();
    expect(screen.getByText("Tortoise")).toBeTruthy();
    expect(screen.getAllByText("$120.00").length).toBeGreaterThanOrEqual(1);

    // Vision item
    expect(screen.getAllByText("Progressive").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Near, middle and far in one lens")).toBeTruthy();

    // Lens item
    expect(screen.getAllByText("Standard Lens").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("$80.00").length).toBeGreaterThanOrEqual(1);

    // Options item
    expect(screen.getByText("1.67 High Index, Clear")).toBeTruthy();

    // Extras item
    expect(screen.getAllByText("Hard Case").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("+$15.00").length).toBeGreaterThanOrEqual(1);

    // Add to cart primary button with total: 120 + 80 + 35 + 15 = $250.00
    expect(screen.getByText("Add to cart \u2014 $250.00")).toBeTruthy();
  });

  it("INV-4: the button total comes from priceSelection (test changes an option and asserts the label)", () => {
    // Selection with 1.67 (+35) -> total = 120 + 80 + 35 = $235.00
    const state1 = createReviewState({
      selection: {
        frameVariantId: "var-frame-harlow",
        rxType: "PROGRESSIVE",
        lensId: "lens-sv",
        optionValueIds: ["val-167"],
        addOnIds: [],
      },
    });

    const { unmount } = render(
      <ReviewStep
        state={state1}
        dispatch={vi.fn()}
        api={mockApi}
        product={fixtureProduct}
      />,
    );

    expect(screen.getByText("Add to cart \u2014 $235.00")).toBeTruthy();
    unmount();

    // Change option: add Grey tint (+20) -> total = 120 + 80 + 35 + 20 = $255.00
    const state2 = createReviewState({
      selection: {
        frameVariantId: "var-frame-harlow",
        rxType: "PROGRESSIVE",
        lensId: "lens-sv",
        optionValueIds: ["val-167", "val-grey"],
        addOnIds: [],
      },
    });

    render(
      <ReviewStep
        state={state2}
        dispatch={vi.fn()}
        api={mockApi}
        product={fixtureProduct}
      />,
    );

    expect(screen.getByText("Add to cart \u2014 $255.00")).toBeTruthy();
  });

  it("Row 6: double-click the button -> one bundle added (button disabled while pending)", async () => {
    let addResolve: (res: Response) => void;
    const pendingPromise = new Promise((resolve) => {
      addResolve = resolve;
    });

    const fetchFn = vi.fn().mockImplementation(() => pendingPromise);
    const state = createReviewState();
    const dispatch = vi.fn();

    render(
      <ReviewStep
        state={state}
        dispatch={dispatch}
        api={mockApi}
        product={fixtureProduct}
        fetchFn={fetchFn as unknown as typeof fetch}
        onRedirect={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /^Add to cart/ });
    expect(button).toBeDefined();

    // Double-click
    fireEvent.click(button);
    fireEvent.click(button);

    // Button should now be disabled and busy
    expect(button.getAttribute("disabled")).not.toBeNull();
    expect(button.getAttribute("aria-busy")).toBe("true");

    // Only one fetch call initiated
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Resolve the promise
    addResolve!(
      new Response(JSON.stringify({ key: "frame-key-1" }), { status: 200 }),
    );

    await waitFor(() => {
      // Once done or during unmount
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  it("Row 7: Edit on 'Lens' row -> goes to step 4 with the selection kept", () => {
    const state = createReviewState();
    const dispatch = vi.fn();

    render(
      <ReviewStep
        state={state}
        dispatch={dispatch}
        api={mockApi}
        product={fixtureProduct}
      />,
    );

    const editLensButton = screen.getByRole("button", { name: "Edit lens" });
    fireEvent.click(editLensButton);

    // 0-based index 3 corresponds to Step 4 ("Lens")
    expect(dispatch).toHaveBeenCalledWith({
      type: "GO_TO_STEP",
      stepIndex: 3,
    });
    // Selection in state is untouched
    expect(state.selection.lensId).toBe("lens-sv");
    expect(state.selection.optionValueIds).toEqual(["val-167", "val-clear"]);
  });

  it("Edit on other rows dispatches GO_TO_STEP for respective steps", () => {
    const state = createReviewState();
    const dispatch = vi.fn();

    render(
      <ReviewStep
        state={state}
        dispatch={dispatch}
        api={mockApi}
        product={fixtureProduct}
      />,
    );

    // Vision -> Step 1 (index 0)
    fireEvent.click(screen.getByRole("button", { name: "Edit vision" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "GO_TO_STEP", stepIndex: 0 });

    // Prescription -> Step 2 (index 1)
    fireEvent.click(screen.getByRole("button", { name: "Edit prescription" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "GO_TO_STEP", stepIndex: 1 });

    // Options -> Step 5 (index 4)
    fireEvent.click(screen.getByRole("button", { name: "Edit options" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "GO_TO_STEP", stepIndex: 4 });

    // Extras -> Step 6 (index 5)
    fireEvent.click(screen.getByRole("button", { name: "Edit extras" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "GO_TO_STEP", stepIndex: 5 });

    // Frame Change -> Step 1 (index 0)
    fireEvent.click(screen.getByRole("button", { name: "Change frame" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "GO_TO_STEP", stepIndex: 0 });
  });

  it("INV-3: storeRxInOrder off -> no property or rendered element contains a formatted Rx number", () => {
    const state = createReviewState({
      catalog: {
        ...fixtureCatalog,
        settings: {
          ...fixtureCatalog.settings,
          storeRxInOrder: false,
        },
      },
    });

    const { container } = render(
      <ReviewStep
        state={state}
        dispatch={vi.fn()}
        api={mockApi}
        product={fixtureProduct}
      />,
    );

    const renderedText = container.textContent ?? "";
    expect(renderedText).toContain(strings.rx.onFile);
    expect(renderedText).not.toContain("-7.75");
    expect(renderedText).not.toContain("7.75");
    expect(renderedText).not.toContain("-1.25");
    expect(renderedText).not.toContain("1.25");
    expect(renderedText).not.toContain("-6.50");
    expect(renderedText).not.toContain("6.50");

    // Table not rendered
    expect(container.querySelector(".la-rxtable")).toBeNull();
  });

  it("INV-3: storeRxInOrder on -> renders prescription table with formatted Rx values", () => {
    const state = createReviewState({
      catalog: {
        ...fixtureCatalog,
        settings: {
          ...fixtureCatalog.settings,
          storeRxInOrder: true,
        },
      },
    });

    const { container } = render(
      <ReviewStep
        state={state}
        dispatch={vi.fn()}
        api={mockApi}
        product={fixtureProduct}
      />,
    );

    expect(container.querySelector(".la-rxtable")).not.toBeNull();
    const renderedText = container.textContent ?? "";
    expect(renderedText).toContain("-7.75");
    expect(renderedText).toContain("-1.25");
    expect(renderedText).toContain("090");
    expect(renderedText).toContain("+2.00");
    expect(renderedText).toContain("-6.50");
    expect(renderedText).toContain("PD 63.0 mm");
  });

  it("child add returns 422 -> displays error with Retry button and retries on click", async () => {
    let attempt = 0;
    const fetchFn = vi.fn().mockImplementation((_url: string) => {
      attempt++;
      if (attempt === 1) {
        // Frame add succeeds
        return Promise.resolve(
          new Response(JSON.stringify({ key: "frame-key-err" }), { status: 200 }),
        );
      }
      if (attempt === 2) {
        // Child add fails 422
        return Promise.resolve(
          new Response(JSON.stringify({ message: "Sold out" }), { status: 422 }),
        );
      }
      if (attempt === 3) {
        // Rollback change.js
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }
      // Retry attempt: succeeds
      return Promise.resolve(
        new Response(JSON.stringify({ key: "frame-retry-ok", items: [] }), { status: 200 }),
      );
    });

    const state = createReviewState();
    const dispatch = vi.fn();

    render(
      <ReviewStep
        state={state}
        dispatch={dispatch}
        api={mockApi}
        product={fixtureProduct}
        fetchFn={fetchFn as unknown as typeof fetch}
        onRedirect={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /^Add to cart/ });
    fireEvent.click(button);

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    expect(screen.getByText("Couldn't add your lenses")).toBeTruthy();
    const retryButton = screen.getByRole("button", { name: "Retry" });
    expect(retryButton).toBeTruthy();

    // Click Retry
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ type: "CLOSE" });
    });
  });

  it("step module contract exports", () => {
    const state = createReviewState();
    expect(reviewStep.id).toBe("review");
    expect(reviewStep.titleKey).toBe("review");
    expect(isReviewStepComplete(state)).toBe(true);
    expect(isReviewStepApplicable(state)).toBe(true);
    expect(reviewStep.Component).toBe(ReviewStep);
  });
});
