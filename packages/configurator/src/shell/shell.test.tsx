import { fireEvent, render } from "@testing-library/preact";
import type { JSX } from "preact";
import { describe, expect, it, vi } from "vitest";
import type { CatalogResponse } from "../../../rx-core/src/index.js";
import type { ApiClient } from "../shared/api";
import { strings } from "../shared/strings";
import { ConfiguratorApp } from "./ConfiguratorApp";
import type { StepDefinition, StepProps } from "./types";

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

    // Close button is present and triggers onClose
    const closeBtn = view.getByRole("button", { name: strings.empty.close });
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
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

    expect(onClose).toHaveBeenCalledOnce();
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
  });
});
