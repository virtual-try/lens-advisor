import { act, fireEvent, render, waitFor } from "@testing-library/preact";
import type { JSX } from "preact";
import { describe, expect, it, vi } from "vitest";
import { selectionSchema, type CatalogResponse } from "../../../rx-core/src/index.js";
import type { ApiClient } from "../shared/api";
import { strings } from "../shared/strings";
import shellCss from "./shell.css?inline";
import { ConfiguratorApp } from "./ConfiguratorApp";
import type { ConfiguratorState, StepDefinition, StepProps } from "./types";

const mockCatalog: CatalogResponse = {
  lensGroups: [
    {
      id: "group-1",
      name: "Single Vision Clear",
      position: 0,
      lenses: [
        {
          id: "lens-1",
          groupId: "group-1",
          name: "Standard 1.50",
          price: { amountMinor: 4900, currency: "USD" },
          limits: {
            sphMin: -600,
            sphMax: 400,
            cylMin: -200,
            cylMax: 0,
            rxTypes: ["SINGLE_VISION"],
          },
          labCodeTemplate: "STD",
          shopifyVariantId: "var-1",
          position: 0,
        },
      ],
    },
  ],
  optionGroups: [],
  addOns: [],
  settings: {
    manualRxEnabled: true,
    rxUploadEnabled: true,
    storeRxInOrder: false,
  },
};

function VisionStep({ state, dispatch }: StepProps): JSX.Element {
  const headingText = `${strings.header.titlePrefix}Vision`;
  const singleVisionLabel = "Select Single Vision";
  const nonRxLabel = "Select Non-Prescription";
  const currentPrefix = "Current: ";
  return (
    <div>
      <h2 role="heading">{headingText}</h2>
      <button
        type="button"
        onClick={() => dispatch({ type: "SET_RX_TYPE", rxType: "SINGLE_VISION" })}
      >
        {singleVisionLabel}
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: "SET_RX_TYPE", rxType: "NON_PRESCRIPTION" })}
      >
        {nonRxLabel}
      </button>
      <p>{currentPrefix}{state.rxType ?? "none"}</p>
    </div>
  );
}

function PrescriptionStep({ state, dispatch }: StepProps): JSX.Element {
  const headingText = "Prescription Details";
  const btnLabel = "Attach Prescription";
  const refPrefix = "Ref: ";
  return (
    <div>
      <h2 role="heading">{headingText}</h2>
      <button
        type="button"
        onClick={() => dispatch({ type: "SET_PRESCRIPTION_REF", prescriptionRef: "rx-123" })}
      >
        {btnLabel}
      </button>
      <p>{refPrefix}{state.prescriptionRef ?? "none"}</p>
    </div>
  );
}

function LensStep({ state, dispatch }: StepProps): JSX.Element {
  const headingText = "Lens Selection";
  const btnLabel = "Select Lens";
  const lensPrefix = "Lens: ";
  return (
    <div>
      <h2 role="heading">{headingText}</h2>
      <button
        type="button"
        onClick={() => dispatch({ type: "SET_LENS", lensId: "lens-1" })}
      >
        {btnLabel}
      </button>
      <p>{lensPrefix}{state.selection.lensId ?? "none"}</p>
    </div>
  );
}

function createFixtureSteps(): StepDefinition[] {
  return [
    {
      id: "vision",
      titleKey: "Vision",
      folder: "01-vision",
      isComplete: (s) => s.rxType !== null,
      isApplicable: () => true,
      Component: VisionStep,
    },
    {
      id: "prescription",
      titleKey: "Prescription",
      folder: "02-prescription",
      isComplete: (s) => s.prescriptionRef !== null || s.prescription !== null,
      isApplicable: (s) => s.rxType !== "NON_PRESCRIPTION",
      Component: PrescriptionStep,
    },
    {
      id: "lens",
      titleKey: "Lens",
      folder: "03-lens",
      isComplete: (s) => Boolean(s.selection.lensId),
      isApplicable: () => true,
      Component: LensStep,
    },
  ];
}

function createMockApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    proxyBase: "/apps/lens-advisor",
    getCatalog: vi.fn(async () => mockCatalog),
    submitPrescription: vi.fn(async () => ({ rxRef: "rx-ref-1" })),
    getUploadUrl: vi.fn(async () => ({
      draftId: "draft-1",
      uploadUrl: "https://example.com/upload",
      key: "shops/1/rx/draft-1/test.pdf",
    })),
    uploadFile: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("Configurator Shell - Examples Table Rows", () => {
  it("Row 1: open, catalog loads -> step 1, Back hidden (normal)", async () => {
    const steps = createFixtureSteps();
    const apiClient = createMockApiClient();

    const view = render(
      <ConfiguratorApp
        product={{ title: "Harlow", id: "prod-1" }}
        steps={steps}
        apiClient={apiClient}
      />,
    );

    // Dialog opens and catalog loads step 1
    const dialog = await view.findByRole("dialog");
    expect(dialog).not.toBeNull();

    // Step 1 is visible
    const heading = await view.findByRole("heading", {
      name: `${strings.header.titlePrefix}Vision`,
    });
    expect(heading).not.toBeNull();

    // Back button is hidden on step 1
    const backBtn = view.queryByRole("button", { name: strings.footer.back });
    expect(backBtn).toBeNull();

    // Continue button is present
    const continueBtn = view.getByRole("button", { name: strings.footer.continue });
    expect(continueBtn).not.toBeNull();
  });

  it("Row 2: Continue on incomplete step -> button disabled, no transition (gating)", async () => {
    const steps = createFixtureSteps();
    const apiClient = createMockApiClient();

    const view = render(
      <ConfiguratorApp
        product={{ title: "Harlow" }}
        steps={steps}
        apiClient={apiClient}
      />,
    );

    await view.findByRole("dialog");
    await view.findByRole("heading", { name: `${strings.header.titlePrefix}Vision` });

    // Step 1 is incomplete (no rxType picked yet)
    const continueBtn = view.getByRole("button", {
      name: strings.footer.continue,
    }) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(true);

    // Attempting to click Continue does not transition
    fireEvent.click(continueBtn);
    expect(
      view.getByRole("heading", { name: `${strings.header.titlePrefix}Vision` }),
    ).not.toBeNull();
  });

  it("Row 3: rxType NON_PRESCRIPTION, Continue from step 1 -> skips prescription step (applicability)", async () => {
    const steps = createFixtureSteps();
    const apiClient = createMockApiClient();

    const view = render(
      <ConfiguratorApp
        product={{ title: "Harlow" }}
        steps={steps}
        apiClient={apiClient}
      />,
    );

    await view.findByRole("dialog");

    // Click 'Select Non-Prescription' on step 1
    const nonRxBtn = await view.findByRole("button", { name: "Select Non-Prescription" });
    fireEvent.click(nonRxBtn);

    // Continue button becomes enabled
    const continueBtn = view.getByRole("button", {
      name: strings.footer.continue,
    }) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(false);

    // Click Continue
    fireEvent.click(continueBtn);

    // Skips prescription step (step 2) and transitions directly to Lens Selection (step 3)
    const lensHeading = await view.findByRole("heading", { name: "Lens Selection" });
    expect(lensHeading).not.toBeNull();

    // Prescription heading is not rendered
    expect(view.queryByRole("heading", { name: "Prescription Details" })).toBeNull();
  });

  it("Row 4: catalog request 500 -> error state with Retry; Retry refetches (failure)", async () => {
    let callCount = 0;
    const apiClient = createMockApiClient({
      getCatalog: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error("Server error");
          (err as { code?: string }).code = "HTTP_ERROR";
          throw err;
        }
        return mockCatalog;
      }),
    });

    const steps = createFixtureSteps();
    const view = render(
      <ConfiguratorApp
        product={{ title: "Harlow" }}
        steps={steps}
        apiClient={apiClient}
      />,
    );

    // Initial load fails: alert role is displayed with error message
    const alert = await view.findByRole("alert");
    expect(alert).not.toBeNull();

    const errorHeading = view.getByRole("heading", { name: strings.error.title });
    expect(errorHeading).not.toBeNull();

    // Retry button is present
    const retryBtn = view.getByRole("button", { name: strings.error.retry });
    expect(retryBtn).not.toBeNull();

    // Clicking Retry refetches and recovers to step 1
    fireEvent.click(retryBtn);

    const visionHeading = await view.findByRole("heading", {
      name: `${strings.header.titlePrefix}Vision`,
    });
    expect(visionHeading).not.toBeNull();
  });

  it("Row 5: catalog with zero lens groups -> empty state, close button (empty)", async () => {
    const apiClient = createMockApiClient({
      getCatalog: vi.fn(async () => ({
        ...mockCatalog,
        lensGroups: [],
      })),
    });

    const steps = createFixtureSteps();
    const onClose = vi.fn();

    const view = render(
      <ConfiguratorApp
        product={{ title: "Harlow" }}
        steps={steps}
        apiClient={apiClient}
        onClose={onClose}
      />,
    );

    // Empty state is displayed
    const emptyHeading = await view.findByRole("heading", {
      name: strings.empty.title,
    });
    expect(emptyHeading).not.toBeNull();
    expect(view.getByText(strings.empty.message)).not.toBeNull();

    // Close button is present and triggers onClose after exit animation
    const closeBtn = view.getByRole("button", { name: strings.empty.close });
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("Row 6: Escape while open -> closes, focus back on the trigger (a11y)", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open configurator";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const steps = createFixtureSteps();
    const apiClient = createMockApiClient();
    const onClose = vi.fn();

    const view = render(
      <ConfiguratorApp
        product={{ title: "Harlow" }}
        steps={steps}
        apiClient={apiClient}
        triggerElement={trigger}
        onClose={onClose}
      />,
    );

    await view.findByRole("dialog");

    // Press Escape
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it("Row 7: viewport 375 -> bottom sheet, sticky footer, no horizontal scroll (layout)", async () => {
    window.innerWidth = 375;
    window.dispatchEvent(new Event("resize"));

    const steps = createFixtureSteps();
    const apiClient = createMockApiClient();

    const view = render(
      <ConfiguratorApp
        product={{ title: "Harlow" }}
        steps={steps}
        apiClient={apiClient}
      />,
    );

    const dialog = await view.findByRole("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog.classList.contains("la-sheet")).toBe(true);

    // Verify footer exists with sticky container class
    const continueBtn = view.getByRole("button", { name: strings.footer.continue });
    const footer = continueBtn.closest("footer");
    expect(footer).not.toBeNull();
    expect(footer?.classList.contains("la-footer")).toBe(true);

    // Verify body container exists and scroll parameters
    const body = dialog.querySelector(".la-body");
    expect(body).not.toBeNull();

    // Discriminating check: assert the exact media-query rules applied for mobile (<= 40rem)
    const doc = dialog.ownerDocument;
    const sheets = Array.from(doc.styleSheets);
    const mobileMediaRules = sheets
      .flatMap((s) => {
        try {
          return Array.from(s.cssRules);
        } catch {
          return [];
        }
      })
      .filter(
        (r): r is CSSMediaRule =>
          "media" in r &&
          typeof (r as CSSMediaRule).media?.mediaText === "string" &&
          (r as CSSMediaRule).media.mediaText.includes("max-width: 40rem"),
      );

    expect(mobileMediaRules.length).toBeGreaterThan(0);
    const innerRules = mobileMediaRules.flatMap(
      (m) => Array.from(m.cssRules) as CSSStyleRule[],
    );

    // 1. Bottom-sheet placement: .la-overlay has align-items: flex-end and padding: 0
    const overlayRule = innerRules.find((r) => r.selectorText === ".la-overlay");
    expect(overlayRule).toBeDefined();
    expect(overlayRule?.style.getPropertyValue("align-items")).toBe("flex-end");
    expect(overlayRule?.style.getPropertyValue("padding")).toBe("0");

    // 2. Bottom-sheet sizing: .la-sheet has max-width: 100% and squared bottom corners
    const sheetRule = innerRules.find((r) => r.selectorText === ".la-sheet");
    expect(sheetRule).toBeDefined();
    expect(sheetRule?.style.getPropertyValue("max-width")).toBe("100%");
    expect(sheetRule?.style.getPropertyValue("border-bottom-left-radius")).toBe("0");

    // 3. Sticky footer: .la-footer has position: sticky and bottom: 0
    const footerRule = innerRules.find((r) => r.selectorText === ".la-footer");
    expect(footerRule).toBeDefined();
    expect(footerRule?.style.getPropertyValue("position")).toBe("sticky");
    expect(footerRule?.style.getPropertyValue("bottom")).toBe("0");

    // 4. No horizontal overflow: .la-body has overflow-x: hidden
    const baseRules = sheets.flatMap((s) => Array.from(s.cssRules) as CSSStyleRule[]);
    const bodyRule = baseRules.find((r) => r.selectorText === ".la-body");
    expect(bodyRule).toBeDefined();
    expect(bodyRule?.style.getPropertyValue("overflow-x")).toBe("hidden");
  });

  it("holds getCatalog pending to assert loading status role and localized title/subtitle, then resolves (R1-F10)", async () => {
    let resolveCatalog!: (val: CatalogResponse) => void;
    const catalogPromise = new Promise<CatalogResponse>((resolve) => {
      resolveCatalog = resolve;
    });

    const steps = createFixtureSteps();
    const apiClient = createMockApiClient({
      getCatalog: vi.fn(() => catalogPromise),
    });

    const view = render(
      <ConfiguratorApp
        product={{ title: "Harlow", id: "prod-1" }}
        steps={steps}
        apiClient={apiClient}
      />,
    );

    // Dialog opens in loading state
    const dialog = await view.findByRole("dialog");
    expect(dialog).not.toBeNull();

    // Loading status role is present with aria-busy="true"
    const statusEl = view.getByRole("status");
    expect(statusEl).not.toBeNull();
    expect(statusEl.getAttribute("aria-busy")).toBe("true");

    // Localized loading title and subtitle
    expect(view.getByText(strings.loading.title)).not.toBeNull();
    expect(view.getByText(strings.loading.subtitle)).not.toBeNull();

    // Now resolve catalog
    resolveCatalog(mockCatalog);

    // Status role and loading text are gone
    await waitFor(() => {
      expect(view.queryByRole("status")).toBeNull();
    });
    expect(view.queryByText(strings.loading.title)).toBeNull();

    // Step 1 content is visible
    expect(
      await view.findByRole("heading", {
        name: `${strings.header.titlePrefix}Vision`,
      }),
    ).not.toBeNull();
  });

  it("renders product.title if present, or localized generic title if absent (R1-F6)", async () => {
    const steps = createFixtureSteps();
    const apiClient = createMockApiClient();

    // 1. With product title
    const viewWithTitle = render(
      <ConfiguratorApp
        product={{ title: "Harlow", id: "prod-1" }}
        steps={steps}
        apiClient={apiClient}
      />,
    );
    await viewWithTitle.findByRole("dialog");
    expect(
      viewWithTitle.getByText(`${strings.header.titlePrefix}Harlow`),
    ).not.toBeNull();
    viewWithTitle.unmount();

    // 2. Without product title (spec 04 block payload)
    const viewWithoutTitle = render(
      <ConfiguratorApp
        product={{ id: "prod-1" }}
        steps={steps}
        apiClient={apiClient}
      />,
    );
    await viewWithoutTitle.findByRole("dialog");
    expect(
      viewWithoutTitle.getByText(strings.header.defaultTitle),
    ).not.toBeNull();
    viewWithoutTitle.unmount();
  });

  it("runs exiting phase before unmount on close (R1-F8, R2-F2)", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();

    const steps = createFixtureSteps();
    const apiClient = createMockApiClient();
    const onClose = vi.fn();

    const view = render(
      <ConfiguratorApp
        product={{ title: "Harlow" }}
        steps={steps}
        apiClient={apiClient}
        triggerElement={trigger}
        onClose={onClose}
      />,
    );

    const dialog = await view.findByRole("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog.classList.contains("la-sheet--exiting")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    // Trigger close via Escape
    fireEvent.keyDown(document, { key: "Escape" });

    // Exiting phase: sheet is STILL mounted in DOM, but has exiting class
    expect(dialog.classList.contains("la-sheet--exiting")).toBe(true);
    const overlay = dialog.closest(".la-overlay");
    expect(overlay?.classList.contains("la-overlay--exiting")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    // After animation duration, onClose called and sheet is unmounted
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it("finishes exit immediately on animationend without waiting for fallback timeout (R2-F2)", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();

    const steps = createFixtureSteps();
    const apiClient = createMockApiClient();
    const onClose = vi.fn();

    const view = render(
      <ConfiguratorApp
        product={{ title: "Harlow" }}
        steps={steps}
        apiClient={apiClient}
        triggerElement={trigger}
        onClose={onClose}
      />,
    );

    const dialog = await view.findByRole("dialog");
    expect(dialog).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // Trigger close via close button
    const closeBtn = view.getByRole("button", { name: strings.header.closeLabel });
    fireEvent.click(closeBtn);

    expect(dialog.classList.contains("la-sheet--exiting")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    // animationend fires on sheet
    fireEvent.animationEnd(dialog, { animationName: "la-modal-exit" });

    // Exit finishes immediately upon animationend
    expect(onClose).toHaveBeenCalledOnce();
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it("supports reduced-motion with immediate unmount, no exiting delay, and focus returned (R2-F3)", async () => {
    // Assert exact reduced-motion styles in shell.css
    expect(shellCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(shellCss).toMatch(/la-fade-enter/);
    expect(shellCss).toMatch(/la-fade-exit/);
    expect(shellCss).toMatch(/transform:\s*none\s*!important/);

    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => {
      return {
        matches: query.includes("prefers-reduced-motion: reduce"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    });

    try {
      const trigger = document.createElement("button");
      trigger.textContent = "Open";
      document.body.appendChild(trigger);
      trigger.focus();

      const steps = createFixtureSteps();
      const apiClient = createMockApiClient();
      const onClose = vi.fn();

      const view = render(
        <ConfiguratorApp
          product={{ title: "Harlow" }}
          steps={steps}
          apiClient={apiClient}
          triggerElement={trigger}
          onClose={onClose}
        />,
      );

      const dialog = await view.findByRole("dialog");
      expect(dialog).not.toBeNull();

      // Trigger close via Escape
      fireEvent.keyDown(document, { key: "Escape" });

      // Reduced motion: still alternative with no exiting delay / immediate unmount
      expect(onClose).toHaveBeenCalledOnce();
      expect(view.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);

      trigger.remove();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("keeps focus trapped inside dialog during exiting phase and restores focus to trigger only after unmount (R2-F4)", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();

    const steps = createFixtureSteps();
    const apiClient = createMockApiClient();
    const onClose = vi.fn();

    const view = render(
      <ConfiguratorApp
        product={{ title: "Harlow" }}
        steps={steps}
        apiClient={apiClient}
        triggerElement={trigger}
        onClose={onClose}
      />,
    );

    const dialog = await view.findByRole("dialog");
    expect(dialog).not.toBeNull();

    // Trigger close via Close button click
    const closeBtn = view.getByRole("button", { name: strings.header.closeLabel });
    fireEvent.click(closeBtn);

    // During exiting phase: sheet is still mounted and exiting
    expect(dialog.classList.contains("la-sheet--exiting")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    // Crucial R2-F4 assertion: focus must NOT be returned to the trigger during exiting phase
    expect(document.activeElement).not.toBe(trigger);
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab key navigation during exit phase: must remain trapped inside dialog
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).not.toBe(trigger);
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Shift+Tab key navigation during exit phase: must remain trapped inside dialog
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).not.toBe(trigger);
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Finish exit animation via animationend
    fireEvent.animationEnd(dialog, { animationName: "la-modal-exit" });

    // After unmount, focus is restored to trigger
    expect(onClose).toHaveBeenCalledOnce();
    expect(view.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it("inerts host's body siblings while open and restores their exact prior state on close and disconnect (R1-F9)", async () => {
    // Background sibling elements in document.body
    const bg1 = document.createElement("div");
    bg1.id = "storefront-main";
    const bg2 = document.createElement("aside");
    bg2.id = "storefront-sidebar";
    bg2.setAttribute("aria-hidden", "true"); // pre-existing aria-hidden
    document.body.appendChild(bg1);
    document.body.appendChild(bg2);

    expect((bg1 as HTMLElement & { inert?: boolean }).inert).toBeFalsy();
    expect(bg1.getAttribute("aria-hidden")).toBeNull();
    expect(bg2.getAttribute("aria-hidden")).toBe("true");

    const steps = createFixtureSteps();
    const apiClient = createMockApiClient();
    const onClose = vi.fn();

    const view = render(
      <ConfiguratorApp
        product={{ title: "Harlow" }}
        steps={steps}
        apiClient={apiClient}
        onClose={onClose}
      />,
    );

    await view.findByRole("dialog");

    // Siblings are now inert and have aria-hidden
    expect(bg1.hasAttribute("inert")).toBe(true);
    expect(bg1.getAttribute("aria-hidden")).toBe("true");
    expect(bg2.hasAttribute("inert")).toBe(true);
    expect(bg2.getAttribute("aria-hidden")).toBe("true");

    // Test close: restores exact prior state
    const closeBtn = view.getByRole("button", { name: strings.header.closeLabel });
    fireEvent.click(closeBtn);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
      expect(bg1.hasAttribute("inert")).toBe(false);
      expect(bg1.getAttribute("aria-hidden")).toBeNull();
      expect(bg2.hasAttribute("inert")).toBe(false);
      expect(bg2.getAttribute("aria-hidden")).toBe("true"); // restored to pre-existing value!
    });

    view.unmount();

    // Test disconnect: open again, then unmount (simulating disconnect)
    const view2 = render(
      <ConfiguratorApp
        product={{ title: "Harlow" }}
        steps={steps}
        apiClient={apiClient}
      />,
    );
    await view2.findByRole("dialog");
    expect(bg1.hasAttribute("inert")).toBe(true);

    act(() => {
      view2.unmount();
    });
    expect(bg1.hasAttribute("inert")).toBe(false);
    expect(bg1.getAttribute("aria-hidden")).toBeNull();
    expect(bg2.hasAttribute("inert")).toBe(false);
    expect(bg2.getAttribute("aria-hidden")).toBe("true");

    bg1.remove();
    bg2.remove();
  });

  it("mounts with literal liquid block payload containing numeric IDs, normalises frameVariantId to string and conforms to spec 03 selectionSchema (R3-F2)", async () => {
    let capturedState: ConfiguratorState | null = null;
    const inspectorHeading = "Frame Inspector";
    function FrameInspectorStep({ state }: StepProps): JSX.Element {
      capturedState = state;
      return (
        <div>
          <h2 role="heading">{inspectorHeading}</h2>
          <span data-testid="frame-id">{state.selection.frameVariantId}</span>
        </div>
      );
    }

    const steps: StepDefinition[] = [
      {
        id: "inspector",
        titleKey: "Inspector",
        folder: "01-inspector",
        isComplete: () => true,
        isApplicable: () => true,
        Component: FrameInspectorStep,
      },
    ];

    // Literal JSON emitted by select-lenses.liquid:
    const liquidPayload = {
      productId: 7891234567890,
      variantIds: [45678901234567, 45678901234568],
      priceMinor: 12900,
      currency: "USD",
      variants: [
        { id: 45678901234567, priceMinor: 12900 },
        { id: 45678901234568, priceMinor: 14900 },
      ],
    };

    const mockApi = createMockApiClient();
    const view = render(
      <ConfiguratorApp
        product={liquidPayload}
        steps={steps}
        apiClient={mockApi}
        isOpen={true}
      />,
    );

    await waitFor(() => {
      expect(view.getByTestId("frame-id")).not.toBeNull();
    });

    expect(capturedState).not.toBeNull();
    expect(capturedState!.selection.frameVariantId).toBe("45678901234567");
    expect(typeof capturedState!.selection.frameVariantId).toBe("string");

    // Spec 03 schema validation on Selection: must succeed with normalized string id
    const parsed = selectionSchema.safeParse(capturedState!.selection);
    expect(parsed.success).toBe(true);

    view.unmount();
  });
});
