import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { JSX } from "preact";
import { useCallback, useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import type { CatalogResponse } from "../../../../rx-core/src/index.js";
import { ApiError, type ApiClient } from "../../shared/api";
import { createInitialState } from "../../shell/reducer";
import type { ConfiguratorAction, ConfiguratorState } from "../../shell/types";
import { PrescriptionStep } from "./PrescriptionStep";
import { isApplicable, isComplete, prescriptionStep } from "./index";
import prescriptionCss from "./prescription.css?inline";
import { strings } from "./strings";

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

function TestWrapper({
  initialState,
  api,
  onDispatch,
}: {
  initialState: ConfiguratorState;
  api: ApiClient;
  onDispatch?: (action: ConfiguratorAction) => void;
}): JSX.Element {
  const [state, setState] = useState<ConfiguratorState>(initialState);

  const handleDispatch = useCallback((action: ConfiguratorAction) => {
    onDispatch?.(action);
    if (action.type === "SET_PRESCRIPTION") {
      setState((prev) => ({ ...prev, prescription: action.prescription }));
    } else if (action.type === "SET_PRESCRIPTION_REF") {
      setState((prev) => ({ ...prev, prescriptionRef: action.prescriptionRef }));
    }
  }, [onDispatch]);

  const complete = prescriptionStep.isComplete(state);

  return (
    <div class="la-sheet">
      <PrescriptionStep state={state} dispatch={handleDispatch} api={api} />
      <div class="la-footer">
        <button
          type="button"
          class="la-btn la-btn--primary"
          disabled={!complete}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

describe("02-prescription step", () => {
  it("exports correct StepModule contract", () => {
    expect(prescriptionStep.id).toBe("prescription");
    expect(prescriptionStep.titleKey).toBe("Prescription");
    expect(typeof prescriptionStep.isComplete).toBe("function");
    expect(typeof prescriptionStep.isApplicable).toBe("function");
    expect(prescriptionStep.Component).toBe(PrescriptionStep);
  });

  // Example Row 7: Non-prescription chosen -> step 2 skipped
  it("Examples row 7: skips step 2 when rxType is NON_PRESCRIPTION (applicability)", () => {
    const nonRxState: ConfiguratorState = {
      ...createInitialState(),
      rxType: "NON_PRESCRIPTION",
    };
    expect(isApplicable(nonRxState)).toBe(false);
    expect(isComplete(nonRxState)).toBe(true);

    const progressiveState: ConfiguratorState = {
      ...createInitialState(),
      rxType: "PROGRESSIVE",
    };
    expect(isApplicable(progressiveState)).toBe(true);
  });

  // Example Row 1: choose Progressive, type OD −2.25/−0.50×180 ADD +2.00, OS −2.00 ADD +2.00, PD 63 -> Continue enabled; submit; rxRef stored
  it("Examples row 1: choose Progressive, type OD −2.25/−0.50×180 ADD +2.00, OS −2.00 ADD +2.00, PD 63 -> Continue enabled; submit; rxRef stored", async () => {
    const initialState: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "PROGRESSIVE",
    };

    const mockApi: ApiClient = {
      proxyBase: "/apps/lens-advisor",
      getCatalog: vi.fn(),
      submitPrescription: vi.fn().mockResolvedValue({ rxRef: "rx_normal_123" }),
      getUploadUrl: vi.fn(),
      uploadFile: vi.fn(),
    };

    const dispatchedActions: ConfiguratorAction[] = [];
    const handleDispatch = (action: ConfiguratorAction) => {
      dispatchedActions.push(action);
    };

    render(
      <TestWrapper
        initialState={initialState}
        api={mockApi}
        onDispatch={handleDispatch}
      />,
    );

    // Initial state: continue button is disabled
    const continueBtn = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(true);

    // Enter OD: SPH -2.25, CYL -0.50, AXIS 180, ADD +2.00
    const odSphInput = screen.getByLabelText(/Right eye \(OD\) Sphere/i);
    const odCylInput = screen.getByLabelText(/Right eye \(OD\) Cylinder/i);
    const odAxisInput = screen.getByLabelText(/Right eye \(OD\) Axis/i);
    const odAddInput = screen.getByLabelText(/Right eye \(OD\) Add/i);

    fireEvent.input(odSphInput, { target: { value: "-2.25" } });
    fireEvent.blur(odSphInput);

    fireEvent.input(odCylInput, { target: { value: "-0.50" } });
    fireEvent.blur(odCylInput);

    fireEvent.input(odAxisInput, { target: { value: "180" } });
    fireEvent.blur(odAxisInput);

    fireEvent.input(odAddInput, { target: { value: "+2.00" } });
    fireEvent.blur(odAddInput);

    // Enter OS: SPH -2.00, ADD +2.00
    const osSphInput = screen.getByLabelText(/Left eye \(OS\) Sphere/i);
    const osAddInput = screen.getByLabelText(/Left eye \(OS\) Add/i);

    fireEvent.input(osSphInput, { target: { value: "-2.00" } });
    fireEvent.blur(osSphInput);

    fireEvent.input(osAddInput, { target: { value: "+2.00" } });
    fireEvent.blur(osAddInput);

    // Enter PD: 63
    const pdInput = screen.getByLabelText(/PD \(mm\)/i);
    fireEvent.input(pdInput, { target: { value: "63" } });
    fireEvent.blur(pdInput);

    // Now Continue button is enabled
    await waitFor(() => {
      expect(continueBtn.disabled).toBe(false);
    });

    // Click Continue
    await act(async () => {
      fireEvent.click(continueBtn);
    });

    // Assert API submit was called with integer units per INV-5
    expect(mockApi.submitPrescription).toHaveBeenCalledWith({
      rxType: "PROGRESSIVE",
      prescription: {
        od: { sph: -225, cyl: -50, axis: 180, add: 200 },
        os: { sph: -200, add: 200 },
        pd: { single: 630 },
      },
    });

    // Assert rxRef stored
    expect(dispatchedActions).toContainEqual({
      type: "SET_PRESCRIPTION_REF",
      prescriptionRef: "rx_normal_123",
    });
  });

  // Example Row 2: CYL −0.50, AXIS empty, blur -> inline "Axis is required when you enter a cylinder"
  it("Examples row 2: CYL −0.50, AXIS empty, blur -> inline 'Axis is required when you enter a cylinder'", async () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "SINGLE_VISION",
    };
    const mockApi = {} as ApiClient;

    render(<TestWrapper initialState={state} api={mockApi} />);

    const odCylInput = screen.getByLabelText(/Right eye \(OD\) Cylinder/i);
    fireEvent.input(odCylInput, { target: { value: "-0.50" } });
    fireEvent.blur(odCylInput);

    const axisError = screen.getByText("Axis is required when you enter a cylinder");
    expect(axisError).not.toBeNull();

    // Field is described by error ID
    const odAxisInput = screen.getByLabelText(/Right eye \(OD\) Axis/i);
    expect(odAxisInput.getAttribute("aria-describedby")).toBe("od-axis-error");
    const errorEl = document.getElementById("od-axis-error");
    expect(errorEl?.textContent).toContain("Axis is required when you enter a cylinder");
  });

  // Example Row 3: type "2.3" in SPH -> inline step error
  it("Examples row 3: type '2.3' in SPH -> inline step error", async () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "SINGLE_VISION",
    };
    const mockApi = {} as ApiClient;

    render(<TestWrapper initialState={state} api={mockApi} />);

    const odSphInput = screen.getByLabelText(/Right eye \(OD\) Sphere/i);
    fireEvent.input(odSphInput, { target: { value: "2.3" } });
    fireEvent.blur(odSphInput);

    expect(screen.getByText(strings.errors.SPH_STEP)).not.toBeNull();
    expect(odSphInput.getAttribute("aria-describedby")).toBe("od-sph-error");
  });

  // Example Row 4: server returns 400 with od.axis -> error shown under OD AXIS
  it("Examples row 4: server returns 400 with od.axis -> error shown under OD AXIS", async () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "SINGLE_VISION",
    };

    const mockApi: ApiClient = {
      proxyBase: "/apps/lens-advisor",
      getCatalog: vi.fn(),
      submitPrescription: vi.fn().mockRejectedValue(
        new ApiError({
          code: "VALIDATION_FAILED",
          status: 400,
          fields: [{ path: "od.axis", code: "AXIS_REQUIRED" }],
        }),
      ),
      getUploadUrl: vi.fn(),
      uploadFile: vi.fn(),
    };

    render(<TestWrapper initialState={state} api={mockApi} />);

    // Fill valid single vision prescription
    const odSphInput = screen.getByLabelText(/Right eye \(OD\) Sphere/i);
    const osSphInput = screen.getByLabelText(/Left eye \(OS\) Sphere/i);
    const pdInput = screen.getByLabelText(/PD \(mm\)/i);

    fireEvent.input(odSphInput, { target: { value: "-2.00" } });
    fireEvent.blur(odSphInput);
    fireEvent.input(osSphInput, { target: { value: "-2.00" } });
    fireEvent.blur(osSphInput);
    fireEvent.input(pdInput, { target: { value: "63" } });
    fireEvent.blur(pdInput);

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => {
      expect((continueBtn as HTMLButtonElement).disabled).toBe(false);
    });

    await act(async () => {
      fireEvent.click(continueBtn);
    });

    await waitFor(() => {
      expect(screen.getByText("Axis is required when you enter a cylinder")).not.toBeNull();
    });

    const odAxisError = document.getElementById("od-axis-error");
    expect(odAxisError?.textContent).toContain("Axis is required when you enter a cylinder");
  });

  // Example Row 5: upload 11 MB file -> inline size error, no request
  it("Examples row 5: upload 11 MB file -> inline size error, no request", async () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "SINGLE_VISION",
    };

    const mockApi: ApiClient = {
      proxyBase: "/apps/lens-advisor",
      getCatalog: vi.fn(),
      submitPrescription: vi.fn(),
      getUploadUrl: vi.fn(),
      uploadFile: vi.fn(),
    };

    render(<TestWrapper initialState={state} api={mockApi} />);

    // Switch to upload tab
    const uploadTab = screen.getByRole("tab", { name: strings.tabs.upload });
    fireEvent.click(uploadTab);

    // 11 MB file
    const file = new File([new Uint8Array(11 * 1024 * 1024)], "rx-scan.pdf", {
      type: "application/pdf",
    });

    const fileInput = document.querySelector('input[type="file"][accept*="pdf"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(screen.getByText(strings.upload.errors.fileTooLarge)).not.toBeNull();
    expect(mockApi.getUploadUrl).not.toHaveBeenCalled();
    expect(mockApi.uploadFile).not.toHaveBeenCalled();
  });

  // Example Row 6: shop disables manual entry -> only Upload shown, no tabs
  it("Examples row 6: shop disables manual entry -> only Upload shown, no tabs", () => {
    const uploadOnlyCatalog: CatalogResponse = {
      ...mockCatalog,
      settings: {
        manualRxEnabled: false,
        rxUploadEnabled: true,
        storeRxInOrder: false,
      },
    };

    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: uploadOnlyCatalog,
      rxType: "SINGLE_VISION",
    };
    const mockApi = {} as ApiClient;

    render(<TestWrapper initialState={state} api={mockApi} />);

    // Tablist is hidden
    expect(screen.queryByRole("tablist")).toBeNull();

    // Upload dropzone is shown
    expect(screen.getByText(strings.upload.dropTitle)).not.toBeNull();

    // Manual fields are absent
    expect(screen.queryByLabelText(/Right eye \(OD\) Sphere/i)).toBeNull();
  });

  // INV-2: a test spies on console.* across a full manual submit and asserts no Rx value is passed
  it("INV-2: spies on console.* across a full manual submit and asserts no Rx value is passed", async () => {
    const consoleLogSpy = vi.spyOn(console, "log");
    const consoleWarnSpy = vi.spyOn(console, "warn");
    const consoleErrorSpy = vi.spyOn(console, "error");
    const consoleInfoSpy = vi.spyOn(console, "info");
    const consoleDebugSpy = vi.spyOn(console, "debug");

    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "PROGRESSIVE",
    };

    const mockApi: ApiClient = {
      proxyBase: "/apps/lens-advisor",
      getCatalog: vi.fn(),
      submitPrescription: vi.fn().mockResolvedValue({ rxRef: "rx-encrypted-ref-999" }),
      getUploadUrl: vi.fn(),
      uploadFile: vi.fn(),
    };

    render(<TestWrapper initialState={state} api={mockApi} />);

    const odSph = screen.getByLabelText(/Right eye \(OD\) Sphere/i);
    const odCyl = screen.getByLabelText(/Right eye \(OD\) Cylinder/i);
    const odAxis = screen.getByLabelText(/Right eye \(OD\) Axis/i);
    const odAdd = screen.getByLabelText(/Right eye \(OD\) Add/i);
    const osSph = screen.getByLabelText(/Left eye \(OS\) Sphere/i);
    const osAdd = screen.getByLabelText(/Left eye \(OS\) Add/i);
    const pdInput = screen.getByLabelText(/PD \(mm\)/i);

    fireEvent.input(odSph, { target: { value: "-2.25" } });
    fireEvent.blur(odSph);
    fireEvent.input(odCyl, { target: { value: "-0.50" } });
    fireEvent.blur(odCyl);
    fireEvent.input(odAxis, { target: { value: "180" } });
    fireEvent.blur(odAxis);
    fireEvent.input(odAdd, { target: { value: "+2.00" } });
    fireEvent.blur(odAdd);
    fireEvent.input(osSph, { target: { value: "-2.00" } });
    fireEvent.blur(osSph);
    fireEvent.input(osAdd, { target: { value: "+2.00" } });
    fireEvent.blur(osAdd);
    fireEvent.input(pdInput, { target: { value: "63" } });
    fireEvent.blur(pdInput);

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => {
      expect((continueBtn as HTMLButtonElement).disabled).toBe(false);
    });

    await act(async () => {
      fireEvent.click(continueBtn);
    });

    expect(mockApi.submitPrescription).toHaveBeenCalled();

    // Verify all console spies: none contain any Rx values
    const rxValuesToCheck = ["-2.25", "-225", "-0.50", "-50", "180", "+2.00", "200", "-2.00", "-200", "63", "630"];
    const allSpies = [consoleLogSpy, consoleWarnSpy, consoleErrorSpy, consoleInfoSpy, consoleDebugSpy];

    for (const spy of allSpies) {
      for (const call of spy.mock.calls) {
        const callStr = JSON.stringify(call);
        for (const val of rxValuesToCheck) {
          expect(callStr).not.toContain(val);
        }
      }
    }

    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });

  it("handles copy to left eye button", () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "PROGRESSIVE",
    };
    const mockApi = {} as ApiClient;

    render(<TestWrapper initialState={state} api={mockApi} />);

    const odSph = screen.getByLabelText(/Right eye \(OD\) Sphere/i);
    const odCyl = screen.getByLabelText(/Right eye \(OD\) Cylinder/i);
    const odAxis = screen.getByLabelText(/Right eye \(OD\) Axis/i);
    const odAdd = screen.getByLabelText(/Right eye \(OD\) Add/i);

    fireEvent.input(odSph, { target: { value: "-3.25" } });
    fireEvent.input(odCyl, { target: { value: "-1.00" } });
    fireEvent.input(odAxis, { target: { value: "90" } });
    fireEvent.input(odAdd, { target: { value: "+1.50" } });

    const copyBtn = screen.getByRole("button", { name: strings.grid.copyToLeft });
    fireEvent.click(copyBtn);

    const osSph = screen.getByLabelText(/Left eye \(OS\) Sphere/i) as HTMLInputElement;
    const osCyl = screen.getByLabelText(/Left eye \(OS\) Cylinder/i) as HTMLInputElement;
    const osAxis = screen.getByLabelText(/Left eye \(OS\) Axis/i) as HTMLInputElement;
    const osAdd = screen.getByLabelText(/Left eye \(OS\) Add/i) as HTMLInputElement;

    expect(osSph.value).toBe("-3.25");
    expect(osCyl.value).toBe("-1.00");
    expect(osAxis.value).toBe("90");
    expect(osAdd.value).toBe("+1.50");
  });

  it("handles dual PD mode toggle and validation", () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "SINGLE_VISION",
    };
    const mockApi = {} as ApiClient;

    render(<TestWrapper initialState={state} api={mockApi} />);

    // Initially single PD mode
    expect(screen.getByLabelText(/PD \(mm\)/i)).not.toBeNull();

    // Switch to dual PD mode
    const dualRadio = screen.getByRole("radio", { name: strings.pd.dualMode });
    fireEvent.click(dualRadio);

    // Single PD hidden, dual OD/OS PD visible
    expect(screen.queryByLabelText(/PD \(mm\)/i)).toBeNull();
    const dualRight = screen.getByLabelText(/Right \(mm\)/i);
    const dualLeft = screen.getByLabelText(/Left \(mm\)/i);
    expect(dualRight).not.toBeNull();
    expect(dualLeft).not.toBeNull();

    // Validate dual PD range (25.0–40.0)
    fireEvent.input(dualRight, { target: { value: "20.0" } });
    fireEvent.blur(dualRight);
    expect(screen.getByText(strings.errors.PD_RANGE)).not.toBeNull();

    fireEvent.input(dualRight, { target: { value: "31.5" } });
    fireEvent.blur(dualRight);
    expect(screen.queryByText(strings.errors.PD_RANGE)).toBeNull();
  });

  it("completes upload flow: getUploadUrl, uploadFile, submitPrescription, file chip with remove", async () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "SINGLE_VISION",
    };

    const mockApi: ApiClient = {
      proxyBase: "/apps/lens-advisor",
      getCatalog: vi.fn(),
      submitPrescription: vi.fn().mockResolvedValue({ rxRef: "rx-uploaded-777" }),
      getUploadUrl: vi.fn().mockResolvedValue({
        draftId: "draft-777",
        uploadUrl: "https://upload.example.com/s3-put",
        key: "shops/shop-1/rx/draft-777.jpg",
      }),
      uploadFile: vi.fn().mockResolvedValue(undefined),
    };

    const dispatchedActions: ConfiguratorAction[] = [];
    const handleDispatch = (action: ConfiguratorAction) => {
      dispatchedActions.push(action);
    };

    render(
      <TestWrapper
        initialState={state}
        api={mockApi}
        onDispatch={handleDispatch}
      />,
    );

    // Switch to upload tab
    const uploadTab = screen.getByRole("tab", { name: strings.tabs.upload });
    fireEvent.click(uploadTab);

    // 1.2 MB JPG file
    const file = new File([new Uint8Array(1200000)], "my-prescription.jpg", {
      type: "image/jpeg",
    });

    const fileInput = document.querySelector('input[type="file"][accept*="jpeg"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    // Verify upload and submit
    await waitFor(() => {
      expect(mockApi.getUploadUrl).toHaveBeenCalledWith(file);
      expect(mockApi.uploadFile).toHaveBeenCalledWith("https://upload.example.com/s3-put", file);
      expect(mockApi.submitPrescription).toHaveBeenCalledWith({
        rxType: "SINGLE_VISION",
        uploadedKeys: ["shops/shop-1/rx/draft-777.jpg"],
        draftId: "draft-777",
      });
      expect(dispatchedActions).toContainEqual({
        type: "SET_PRESCRIPTION_REF",
        prescriptionRef: "rx-uploaded-777",
      });
    });

    // File chip rendered with file name, size, and remove button
    expect(screen.getByText("my-prescription.jpg")).not.toBeNull();
    const removeBtn = screen.getByRole("button", {
      name: new RegExp(`${strings.upload.removeLabel} my-prescription.jpg`, "i"),
    });
    expect(removeBtn).not.toBeNull();

    // Click remove button
    fireEvent.click(removeBtn);

    // File chip removed, rxRef cleared
    expect(screen.queryByText("my-prescription.jpg")).toBeNull();
    expect(dispatchedActions).toContainEqual({
      type: "SET_PRESCRIPTION_REF",
      prescriptionRef: "",
    });
  });

  // Self-check 1: At 375 px the OD/OS grid fits without horizontal scroll
  it("Self-check 1: OD/OS mobile styles ensure grid fits at 375 viewport width without horizontal scroll", () => {
    // Assert prescriptionCss contains the layout rules for mobile
    expect(prescriptionCss).toContain("@media (max-width: 40rem)");
    expect(prescriptionCss).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)");
    expect(prescriptionCss).toContain("grid-column: 1 / -1");
    expect(prescriptionCss).toContain(".la-rx {");
  });

  // Self-check 2: Every field has a visible label and an aria-describedby to its error
  it("Self-check 2: every field has a visible label and an aria-describedby to its error", () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "PROGRESSIVE",
    };
    const mockApi = {} as ApiClient;

    render(<TestWrapper initialState={state} api={mockApi} />);

    const fields = [
      { id: "od-sph", errorId: "od-sph-error", labelText: /Right eye \(OD\) Sphere/i },
      { id: "os-sph", errorId: "os-sph-error", labelText: /Left eye \(OS\) Sphere/i },
      { id: "od-cyl", errorId: "od-cyl-error", labelText: /Right eye \(OD\) Cylinder/i },
      { id: "os-cyl", errorId: "os-cyl-error", labelText: /Left eye \(OS\) Cylinder/i },
      { id: "od-axis", errorId: "od-axis-error", labelText: /Right eye \(OD\) Axis/i },
      { id: "os-axis", errorId: "os-axis-error", labelText: /Left eye \(OS\) Axis/i },
      { id: "od-add", errorId: "od-add-error", labelText: /Right eye \(OD\) Add/i },
      { id: "os-add", errorId: "os-add-error", labelText: /Left eye \(OS\) Add/i },
      { id: "pd-single", errorId: "pd-single-error", labelText: /PD \(mm\)/i },
    ];

    for (const f of fields) {
      const input = document.getElementById(f.id) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input?.getAttribute("aria-describedby")).toBe(f.errorId);
      const errorEl = document.getElementById(f.errorId);
      expect(errorEl).not.toBeNull();
      expect(screen.getByLabelText(f.labelText)).toBe(input);
    }
  });
});
