import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { JSX } from "preact";
import { useCallback, useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogResponse } from "../../../../rx-core/src/index.js";
import { ApiError, type ApiClient } from "../../shared/api";
import { Footer } from "../../shell/Footer";
import { createInitialState, configuratorReducer } from "../../shell/reducer";
import type { ConfiguratorAction, ConfiguratorState, StepDefinition } from "../../shell/types";
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
    } else if (action.type === "CLEAR_PRESCRIPTION") {
      setState((prev) => ({ ...prev, prescription: null, prescriptionRef: null }));
    } else if (action.type === "SET_PRESCRIPTION_REF") {
      setState((prev) => ({ ...prev, prescriptionRef: action.prescriptionRef }));
    } else if (action.type === "CONTINUE") {
      if (prescriptionStep.isComplete(state)) {
        setState((prev) => ({ ...prev, stepIndex: prev.stepIndex + 1 }));
      }
    }
  }, [onDispatch, state]);

  const canContinue = prescriptionStep.canContinue
    ? prescriptionStep.canContinue(state)
    : prescriptionStep.isComplete(state);

  return (
    <div class="la-sheet">
      <PrescriptionStep state={state} dispatch={handleDispatch} api={api} />
      <Footer
        state={state}
        dispatch={handleDispatch}
        api={api}
        canGoBack={false}
        canContinue={canContinue}
        isComplete={prescriptionStep.isComplete(state)}
        onBack={() => {}}
        onContinue={async () => {
          if (prescriptionStep.onContinue) {
            await prescriptionStep.onContinue({ state, dispatch: handleDispatch, api });
          } else {
            handleDispatch({ type: "CONTINUE" });
          }
        }}
      />
    </div>
  );
}

describe("02-prescription step", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports correct StepModule contract", () => {
    expect(prescriptionStep.id).toBe("prescription");
    expect(prescriptionStep.titleKey).toBe("Prescription");
    expect(typeof prescriptionStep.isComplete).toBe("function");
    expect(typeof prescriptionStep.isApplicable).toBe("function");
    expect(typeof prescriptionStep.canContinue).toBe("function");
    expect(typeof prescriptionStep.onContinue).toBe("function");
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

    // Verify shell skips step 2 for non-prescription
    const stepModules = [
      { id: "rx-type", isApplicable: () => true },
      { id: "prescription", isApplicable: (s: ConfiguratorState) => isApplicable(s) },
      { id: "lens", isApplicable: () => true },
    ];
    const applicableSteps = stepModules.filter((s) => s.isApplicable(nonRxState));
    expect(applicableSteps.map((s) => s.id)).toEqual(["rx-type", "lens"]);
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

    // Now Continue button is enabled via canContinue
    await waitFor(() => {
      expect(continueBtn.disabled).toBe(false);
    });

    const expectedRx = {
      od: { sph: -225, cyl: -50, axis: 180, add: 200 },
      os: { sph: -200, add: 200 },
      pd: { single: 630 },
    };

    // Before submit, prescriptionRef is absent and isComplete is false
    const validUnsubmittedState: ConfiguratorState = {
      ...initialState,
      prescription: expectedRx,
      prescriptionRef: null,
    };
    expect(prescriptionStep.canContinue?.(validUnsubmittedState)).toBe(true);
    expect(prescriptionStep.isComplete(validUnsubmittedState)).toBe(false);

    // Reducer refuses to advance when isComplete is false
    const fixtureSteps: StepDefinition[] = [
      {
        id: "rx-type",
        titleKey: "Vision",
        folder: "01-rx-type",
        isComplete: () => true,
        isApplicable: () => true,
        Component: () => null,
      },
      {
        id: "prescription",
        titleKey: "Prescription",
        folder: "02-prescription",
        isComplete: prescriptionStep.isComplete,
        isApplicable: prescriptionStep.isApplicable,
        canContinue: prescriptionStep.canContinue,
        onContinue: prescriptionStep.onContinue,
        Component: PrescriptionStep,
      },
      {
        id: "lens",
        titleKey: "Lens",
        folder: "03-lens",
        isComplete: () => true,
        isApplicable: () => true,
        Component: () => null,
      },
    ];
    const blockedState = configuratorReducer(
      { ...validUnsubmittedState, stepIndex: 1 },
      { type: "CONTINUE", steps: fixtureSteps },
    );
    expect(blockedState.stepIndex).toBe(1);

    // Click Continue (shell calls onContinue which asks step to submit)
    await act(async () => {
      fireEvent.click(continueBtn);
    });

    // Assert API submit was called with integer units per INV-5
    expect(mockApi.submitPrescription).toHaveBeenCalledWith({
      rxType: "PROGRESSIVE",
      prescription: expectedRx,
    });

    // Assert rxRef stored
    expect(dispatchedActions).toContainEqual({
      type: "SET_PRESCRIPTION_REF",
      prescriptionRef: "rx_normal_123",
    });

    // Advancing happens only after rxRef is set
    const stateWithRef: ConfiguratorState = {
      ...validUnsubmittedState,
      stepIndex: 1,
      prescriptionRef: "rx_normal_123",
    };
    expect(prescriptionStep.isComplete(stateWithRef)).toBe(true);
    const advancedState = configuratorReducer(stateWithRef, {
      type: "CONTINUE",
      steps: fixtureSteps,
    });
    expect(advancedState.stepIndex).toBe(2);

    // Assert CONTINUE dispatched
    expect(dispatchedActions).toContainEqual({
      type: "CONTINUE",
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
  it("Self-check 2: every field has a visible label and an aria-describedby to its error, including dual PD", () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "PROGRESSIVE",
    };
    const mockApi = {} as ApiClient;

    render(<TestWrapper initialState={state} api={mockApi} />);

    // Assert visible row labels exist and contain expected title text
    expect(document.getElementById("lbl-sph-title")?.textContent).toBe(strings.grid.sphere);
    expect(document.getElementById("lbl-cyl-title")?.textContent).toBe(strings.grid.cylinder);
    expect(document.getElementById("lbl-axis-title")?.textContent).toBe(strings.grid.axis);
    expect(document.getElementById("lbl-add-title")?.textContent).toBe(strings.grid.add);

    const fields = [
      { id: "od-sph", errorId: "od-sph-error", labelledBy: "eye-od lbl-sph-title" },
      { id: "os-sph", errorId: "os-sph-error", labelledBy: "eye-os lbl-sph-title" },
      { id: "od-cyl", errorId: "od-cyl-error", labelledBy: "eye-od lbl-cyl-title" },
      { id: "os-cyl", errorId: "os-cyl-error", labelledBy: "eye-os lbl-cyl-title" },
      { id: "od-axis", errorId: "od-axis-error", labelledBy: "eye-od lbl-axis-title" },
      { id: "os-axis", errorId: "os-axis-error", labelledBy: "eye-os lbl-axis-title" },
      { id: "od-add", errorId: "od-add-error", labelledBy: "eye-od lbl-add-title" },
      { id: "os-add", errorId: "os-add-error", labelledBy: "eye-os lbl-add-title" },
      { id: "pd-single", errorId: "pd-single-error", labelFor: "pd-single", visibleText: strings.pd.singleLabel },
    ];

    for (const f of fields) {
      const input = document.getElementById(f.id) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input?.getAttribute("aria-describedby")).toBe(f.errorId);
      const errorEl = document.getElementById(f.errorId);
      expect(errorEl).not.toBeNull();
      if ("labelledBy" in f && f.labelledBy) {
        expect(input?.getAttribute("aria-labelledby")).toBe(f.labelledBy);
      }
      if ("labelFor" in f && f.labelFor) {
        const lbl = document.querySelector(`label[for="${f.labelFor}"]`);
        expect(lbl).not.toBeNull();
        expect(lbl?.textContent?.trim()).toBe(f.visibleText);
      }
    }

    // Toggle to Dual PD mode and verify dual-PD inputs
    const dualRadio = screen.getByRole("radio", { name: strings.pd.dualMode });
    fireEvent.click(dualRadio);

    const dualFields = [
      { id: "pd-od", errorId: "pd-od-error", labelFor: "pd-od", visibleText: strings.pd.dualRightLabel },
      { id: "pd-os", errorId: "pd-os-error", labelFor: "pd-os", visibleText: strings.pd.dualLeftLabel },
    ];

    for (const f of dualFields) {
      const input = document.getElementById(f.id) as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input?.getAttribute("aria-describedby")).toBe(f.errorId);
      const lbl = document.querySelector(`label[for="${f.labelFor}"]`);
      expect(lbl).not.toBeNull();
      expect(lbl?.textContent?.trim()).toBe(f.visibleText);
    }
  });

  // R1-F1: typing manual Rx, switching to upload tab, and clicking Continue submits the typed Rx
  it("R1-F1: typing manual Rx, switching to upload tab, and clicking Continue submits the typed Rx", async () => {
    const initialState: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "SINGLE_VISION",
    };

    const mockApi: ApiClient = {
      proxyBase: "/apps/lens-advisor",
      getCatalog: vi.fn(),
      submitPrescription: vi.fn().mockResolvedValue({ rxRef: "rx-ref-manual-tab-switched" }),
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

    // Type valid manual Rx
    const odSph = screen.getByLabelText(/Right eye.*Sphere/i);
    const osSph = screen.getByLabelText(/Left eye.*Sphere/i);
    const pdInput = screen.getByLabelText(/PD \(mm\)/i);

    fireEvent.input(odSph, { target: { value: "-2.00" } });
    fireEvent.blur(odSph);
    fireEvent.input(osSph, { target: { value: "-2.00" } });
    fireEvent.blur(osSph);
    fireEvent.input(pdInput, { target: { value: "63" } });
    fireEvent.blur(pdInput);

    // Continue is now enabled
    const continueBtn = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    await waitFor(() => {
      expect(continueBtn.disabled).toBe(false);
    });

    // Switch tab to "Upload a photo"
    const uploadTab = screen.getByRole("tab", { name: /Upload/i });
    fireEvent.click(uploadTab);

    // Click Continue
    await act(async () => {
      fireEvent.click(continueBtn);
    });

    // Expect submitPrescription to be called with the typed Rx
    expect(mockApi.submitPrescription).toHaveBeenCalledWith({
      rxType: "SINGLE_VISION",
      prescription: expect.objectContaining({
        od: expect.objectContaining({ sph: -200 }),
        os: expect.objectContaining({ sph: -200 }),
        pd: { single: 630 },
      }),
    });

    // Expect rxRef stored and CONTINUE dispatched
    expect(dispatchedActions).toContainEqual({
      type: "SET_PRESCRIPTION_REF",
      prescriptionRef: "rx-ref-manual-tab-switched",
    });
    expect(dispatchedActions).toContainEqual({ type: "CONTINUE" });
  });

  // R1-F2: editing a value clears prescriptionRef and clicking Continue calls submitPrescription a second time
  it("R1-F2: editing a value clears prescriptionRef and clicking Continue calls submitPrescription a second time", async () => {
    const initialState: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "SINGLE_VISION",
    };

    const mockApi: ApiClient = {
      proxyBase: "/apps/lens-advisor",
      getCatalog: vi.fn(),
      submitPrescription: vi
        .fn()
        .mockResolvedValueOnce({ rxRef: "rx-first-ref" })
        .mockResolvedValueOnce({ rxRef: "rx-second-ref" }),
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

    const odSph = screen.getByLabelText(/Right eye.*Sphere/i);
    const osSph = screen.getByLabelText(/Left eye.*Sphere/i);
    const pdInput = screen.getByLabelText(/PD \(mm\)/i);

    fireEvent.input(odSph, { target: { value: "-2.00" } });
    fireEvent.blur(odSph);
    fireEvent.input(osSph, { target: { value: "-2.00" } });
    fireEvent.blur(osSph);
    fireEvent.input(pdInput, { target: { value: "63" } });
    fireEvent.blur(pdInput);

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => {
      expect((continueBtn as HTMLButtonElement).disabled).toBe(false);
    });

    // First submit
    await act(async () => {
      fireEvent.click(continueBtn);
    });
    expect(mockApi.submitPrescription).toHaveBeenCalledTimes(1);
    expect(dispatchedActions).toContainEqual({
      type: "SET_PRESCRIPTION_REF",
      prescriptionRef: "rx-first-ref",
    });

    // Edit SPH
    fireEvent.input(odSph, { target: { value: "-3.00" } });
    fireEvent.blur(odSph);

    // prescriptionRef was cleared
    expect(dispatchedActions).toContainEqual({
      type: "SET_PRESCRIPTION_REF",
      prescriptionRef: "",
    });

    // Click Continue again
    await act(async () => {
      fireEvent.click(continueBtn);
    });

    // Second submitPrescription call
    expect(mockApi.submitPrescription).toHaveBeenCalledTimes(2);
    expect(mockApi.submitPrescription).toHaveBeenLastCalledWith({
      rxType: "SINGLE_VISION",
      prescription: expect.objectContaining({
        od: expect.objectContaining({ sph: -300 }),
      }),
    });
    expect(dispatchedActions).toContainEqual({
      type: "SET_PRESCRIPTION_REF",
      prescriptionRef: "rx-second-ref",
    });
  });

  // R1-F3: rehydrates inputs from state.prescription on remount
  it("R1-F3: rehydrates inputs from state.prescription on remount", () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "PROGRESSIVE",
      prescription: {
        od: { sph: -225, cyl: -50, axis: 180, add: 200 },
        os: { sph: -200, add: 200 },
        pd: { single: 630 },
      },
      prescriptionRef: "rx-existing-123",
    };
    const mockApi = {} as ApiClient;

    render(<TestWrapper initialState={state} api={mockApi} />);

    expect((screen.getByLabelText(/Right eye.*Sphere/i) as HTMLInputElement).value).toBe("-2.25");
    expect((screen.getByLabelText(/Right eye.*Cylinder/i) as HTMLInputElement).value).toBe("-0.50");
    expect((screen.getByLabelText(/Right eye.*Axis/i) as HTMLInputElement).value).toBe("180");
    expect((screen.getByLabelText(/Right eye.*Add/i) as HTMLInputElement).value).toBe("+2.00");
    expect((screen.getByLabelText(/Left eye.*Sphere/i) as HTMLInputElement).value).toBe("-2.00");
    expect((screen.getByLabelText(/Left eye.*Add/i) as HTMLInputElement).value).toBe("+2.00");
    expect((screen.getByLabelText(/PD \(mm\)/i) as HTMLInputElement).value).toBe("63");
  });

  it("R1-F3: rehydrates file chip on upload tab when prescriptionRef exists without manual prescription", () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "SINGLE_VISION",
      prescription: null,
      prescriptionRef: "rx-file-ref-123",
    };
    const mockApi = {} as ApiClient;

    render(<TestWrapper initialState={state} api={mockApi} />);

    expect(screen.getByText(strings.upload.fileChip.onFile)).not.toBeNull();
  });

  // R1-F4: upload controls drop tabIndex on labels, focusing input directly, and CSS provides visible focus
  it("R1-F4: upload controls drop tabIndex on labels, focusing input directly, and CSS provides visible focus for PD and upload controls", () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "SINGLE_VISION",
    };
    const mockApi = {} as ApiClient;

    render(<TestWrapper initialState={state} api={mockApi} />);

    // Switch to upload tab
    fireEvent.click(screen.getByRole("tab", { name: /Upload/i }));

    const chooseFileBtnText = screen.getByText(strings.upload.chooseFile);
    const chooseFileLabel = chooseFileBtnText.closest("label");
    expect(chooseFileLabel).not.toBeNull();
    expect(chooseFileLabel?.hasAttribute("tabindex")).toBe(false);

    const takePhotoBtnText = screen.getByText(strings.upload.takePhoto);
    const takePhotoLabel = takePhotoBtnText.closest("label");
    expect(takePhotoLabel).not.toBeNull();
    expect(takePhotoLabel?.hasAttribute("tabindex")).toBe(false);

    // CSS check for :has(input:focus-visible)
    expect(prescriptionCss).toContain(".la-segment label:has(input:focus-visible)");
    expect(prescriptionCss).toContain(".la-drop__actions label:has(input:focus-visible)");
  });

  // R1-F5: reduced motion in prescriptionCss
  it("R1-F5: disables transitions under prefers-reduced-motion: reduce", () => {
    expect(prescriptionCss).toContain("prefers-reduced-motion: reduce");
    expect(prescriptionCss).toMatch(/@media[^{]*prefers-reduced-motion:\s*reduce[^{]*\{[\s\S]*?\.la-tab[\s\S]*?transition:\s*none/);
    expect(prescriptionCss).toMatch(/@media[^{]*prefers-reduced-motion:\s*reduce[^{]*\{[\s\S]*?\.la-segment label[\s\S]*?transition:\s*none/);
    expect(prescriptionCss).toMatch(/@media[^{]*prefers-reduced-motion:\s*reduce[^{]*\{[\s\S]*?\.la-drop[\s\S]*?transition:\s*none/);
  });

  // R1-F6: maps ApiError.code to strings.ts without rendering raw err.message or unknown codes, and rejects invalid MIME types even with allowed extension
  it("R1-F6: maps ApiError.code to strings.ts without rendering raw err.message or unknown codes, and rejects invalid MIME types even with allowed extension", async () => {
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
          status: 400,
          message: 'Zod raw error dump: [{"message": "Invalid"}]',
          code: "VALIDATION_FAILED",
        }),
      ),
      getUploadUrl: vi.fn(),
      uploadFile: vi.fn(),
    };

    render(<TestWrapper initialState={state} api={mockApi} />);

    const odSph = screen.getByLabelText(/Right eye.*Sphere/i);
    const osSph = screen.getByLabelText(/Left eye.*Sphere/i);
    const pdInput = screen.getByLabelText(/PD \(mm\)/i);

    fireEvent.input(odSph, { target: { value: "-2.00" } });
    fireEvent.blur(odSph);
    fireEvent.input(osSph, { target: { value: "-2.00" } });
    fireEvent.blur(osSph);
    fireEvent.input(pdInput, { target: { value: "63" } });
    fireEvent.blur(pdInput);

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => {
      expect((continueBtn as HTMLButtonElement).disabled).toBe(false);
    });

    await act(async () => {
      fireEvent.click(continueBtn);
    });

    // Shows mapped strings message, NOT raw zod dump
    await waitFor(() => {
      expect(screen.queryByText(/Zod raw error dump/i)).toBeNull();
      expect(screen.getByText(strings.apiErrors.VALIDATION_FAILED)).not.toBeNull();
    });

    // Now test upload tab with disallowed MIME type and .pdf extension
    fireEvent.click(screen.getByRole("tab", { name: /Upload/i }));

    const disallowedMimeFile = new File(["dummy content"], "prescription.pdf", {
      type: "application/octet-stream",
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [disallowedMimeFile] } });
    });

    expect(screen.getByText(strings.upload.errors.invalidType)).not.toBeNull();
    expect(mockApi.getUploadUrl).not.toHaveBeenCalled();
  });

  // R1-F8: progress element during upload
  it("R1-F8: displays progress element with accessible label during upload", async () => {
    let resolveUpload: () => void;
    const uploadPromise = new Promise<{ rxRef: string }>((resolve) => {
      resolveUpload = () => resolve({ rxRef: "rx-uploaded-progress" });
    });

    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "SINGLE_VISION",
    };

    const mockApi: ApiClient = {
      proxyBase: "/apps/lens-advisor",
      getCatalog: vi.fn(),
      submitPrescription: vi.fn().mockImplementation(() => uploadPromise),
      getUploadUrl: vi.fn().mockResolvedValue({ uploadUrl: "https://upload.example.com", key: "k1", draftId: "d1" }),
      uploadFile: vi.fn().mockResolvedValue(undefined),
    };

    render(<TestWrapper initialState={state} api={mockApi} />);

    fireEvent.click(screen.getByRole("tab", { name: /Upload/i }));

    const validFile = new File(["dummy"], "rx.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    act(() => {
      fireEvent.change(fileInput, { target: { files: [validFile] } });
    });

    // Check for progress element with accessible label
    await waitFor(() => {
      const progressEl = screen.getByRole("progressbar");
      expect(progressEl).not.toBeNull();
      expect(progressEl.getAttribute("aria-label")).toBe(strings.upload.progressLabel);
    });

    await act(async () => {
      resolveUpload!();
    });
  });

  // R2-F1: isComplete returns false on valid prescription without prescriptionRef and true only with prescriptionRef or NON_PRESCRIPTION
  it("R2-F1: isComplete returns false on valid prescription without prescriptionRef and true only with prescriptionRef or NON_PRESCRIPTION", () => {
    const validRx = {
      od: { sph: -200 },
      os: { sph: -200 },
      pd: { single: 630 },
    };

    const stateWithValidRxOnly: ConfiguratorState = {
      ...createInitialState(),
      rxType: "SINGLE_VISION",
      prescription: validRx,
      prescriptionRef: null,
    };

    // isComplete MUST be false per spec
    expect(isComplete(stateWithValidRxOnly)).toBe(false);
    expect(prescriptionStep.isComplete(stateWithValidRxOnly)).toBe(false);

    // canContinue is true so footer button is enabled
    expect(prescriptionStep.canContinue!(stateWithValidRxOnly)).toBe(true);

    // When prescriptionRef is set, isComplete is true
    const stateWithRxRef: ConfiguratorState = {
      ...stateWithValidRxOnly,
      prescriptionRef: "rx-ref-999",
    };
    expect(isComplete(stateWithRxRef)).toBe(true);
    expect(prescriptionStep.isComplete(stateWithRxRef)).toBe(true);

    // For NON_PRESCRIPTION, isComplete is true
    const nonRxState: ConfiguratorState = {
      ...createInitialState(),
      rxType: "NON_PRESCRIPTION",
      prescription: null,
      prescriptionRef: null,
    };
    expect(isComplete(nonRxState)).toBe(true);
    expect(prescriptionStep.isComplete(nonRxState)).toBe(true);

    // Reducer CONTINUE and GO_TO_STEP gate step 2
    const fixtureSteps: StepDefinition[] = [
      {
        id: "rx-type",
        titleKey: "Vision",
        folder: "01-rx-type",
        isComplete: () => true,
        isApplicable: () => true,
        Component: () => null,
      },
      {
        id: "prescription",
        titleKey: "Prescription",
        folder: "02-prescription",
        isComplete: prescriptionStep.isComplete,
        isApplicable: prescriptionStep.isApplicable,
        canContinue: prescriptionStep.canContinue,
        onContinue: prescriptionStep.onContinue,
        Component: PrescriptionStep,
      },
      {
        id: "lens",
        titleKey: "Lens",
        folder: "03-lens",
        isComplete: () => true,
        isApplicable: () => true,
        Component: () => null,
      },
    ];

    const currentStep2: ConfiguratorState = {
      ...stateWithValidRxOnly,
      stepIndex: 1,
    };

    // CONTINUE does not advance without rxRef
    const afterContinue = configuratorReducer(currentStep2, {
      type: "CONTINUE",
      steps: fixtureSteps,
    });
    expect(afterContinue.stepIndex).toBe(1);

    // GO_TO_STEP to step 2 (lens, index 2) does not advance without rxRef
    const afterGoTo = configuratorReducer(currentStep2, {
      type: "GO_TO_STEP",
      stepIndex: 2,
      steps: fixtureSteps,
    });
    expect(afterGoTo.stepIndex).toBe(1);
  });

  // R2-F2: CLEAR_PRESCRIPTION dispatched when form becomes invalid and rehydration shows empty, never stale Rx
  it("R2-F2: dispatches CLEAR_PRESCRIPTION when form turns invalid and rehydration shows empty, never stale Rx", async () => {
    const initialState: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "SINGLE_VISION",
    };

    const mockApi: ApiClient = {
      proxyBase: "/apps/lens-advisor",
      getCatalog: vi.fn(),
      submitPrescription: vi.fn().mockResolvedValue({ rxRef: "rx-123" }),
      getUploadUrl: vi.fn(),
      uploadFile: vi.fn(),
    };

    const dispatched: ConfiguratorAction[] = [];
    let latestState = initialState;

    const { unmount } = render(
      <TestWrapper
        initialState={initialState}
        api={mockApi}
        onDispatch={(act) => {
          dispatched.push(act);
          if (act.type === "SET_PRESCRIPTION") {
            latestState = { ...latestState, prescription: act.prescription };
          } else if (act.type === "CLEAR_PRESCRIPTION") {
            latestState = { ...latestState, prescription: null, prescriptionRef: null };
          }
        }}
      />,
    );

    const odSph = screen.getByLabelText(/Right eye.*Sphere/i);
    const osSph = screen.getByLabelText(/Left eye.*Sphere/i);
    const pdInput = screen.getByLabelText(/PD \(mm\)/i);

    // Type valid Rx
    fireEvent.input(odSph, { target: { value: "-2.00" } });
    fireEvent.blur(odSph);
    fireEvent.input(osSph, { target: { value: "-2.00" } });
    fireEvent.blur(osSph);
    fireEvent.input(pdInput, { target: { value: "63" } });
    fireEvent.blur(pdInput);

    await waitFor(() => {
      expect(dispatched).toContainEqual(
        expect.objectContaining({
          type: "SET_PRESCRIPTION",
          prescription: expect.objectContaining({ od: { sph: -200 } }),
        }),
      );
    });
    expect(latestState.prescription).not.toBeNull();

    // Now edit SPH to an invalid value (empty)
    fireEvent.input(odSph, { target: { value: "" } });
    fireEvent.blur(odSph);

    // Must dispatch CLEAR_PRESCRIPTION
    await waitFor(() => {
      expect(dispatched).toContainEqual({ type: "CLEAR_PRESCRIPTION" });
    });
    expect(latestState.prescription).toBeNull();

    unmount();

    // Remount with latestState (which had its prescription cleared)
    render(<TestWrapper initialState={latestState} api={mockApi} />);

    // Inputs must be empty, NOT the old stale -2.00
    const remountedOdSph = screen.getByLabelText(/Right eye.*Sphere/i) as HTMLInputElement;
    const remountedOsSph = screen.getByLabelText(/Left eye.*Sphere/i) as HTMLInputElement;
    expect(remountedOdSph.value).toBe("");
    expect(remountedOsSph.value).toBe("");
  });

  // R2-F3: .la-link and .la-copy have min-height var(--la-target) and inline-flex alignment
  it("R2-F3: .la-link and .la-copy have min-height var(--la-target) and inline-flex alignment", () => {
    expect(prescriptionCss).toMatch(
      /\.la-link\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*min-height:\s*var\(--la-target\);/,
    );
    expect(prescriptionCss).toMatch(
      /\.la-copy\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*min-height:\s*var\(--la-target\);/,
    );
  });

  // R2-F4: prescriptionCss defines .la-help styles tokens only
  it("R2-F4: prescription.css defines .la-help disclosure styles tokens only", () => {
    expect(prescriptionCss).toMatch(/\.la-help\s*\{[^}]*border-top:[^}]*var\(--la-border-width\)/);
    expect(prescriptionCss).toMatch(/\.la-help summary\s*\{[^}]*min-height:\s*var\(--la-target\);/);
    expect(prescriptionCss).toMatch(/\.la-help summary:focus-visible\s*\{[^}]*outline:\s*var\(--la-focus-outline\);/);
    expect(prescriptionCss).toMatch(/\.la-help dl\s*\{[^}]*display:\s*flex;/);
    expect(prescriptionCss).toMatch(/\.la-help dt\s*\{[^}]*font-size:\s*var\(--la-text-sm\);/);
    expect(prescriptionCss).toMatch(/\.la-help dd\s*\{[^}]*font-size:\s*var\(--la-text-sm\);/);
  });

  // R2-F5: unmapped server 400 field errors and unknown od.*/os.* paths show form-level error, not SPH
  it("R2-F5: sets submitError to VALIDATION_FAILED when server 400 has unmapped fields (e.g. rxType)", async () => {
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
          status: 400,
          code: "VALIDATION_FAILED",
          fields: [{ path: "rxType", code: "INVALID" }],
        }),
      ),
      getUploadUrl: vi.fn(),
      uploadFile: vi.fn(),
    };

    render(<TestWrapper initialState={state} api={mockApi} />);

    const odSph = screen.getByLabelText(/Right eye.*Sphere/i);
    const osSph = screen.getByLabelText(/Left eye.*Sphere/i);
    const pdInput = screen.getByLabelText(/PD \(mm\)/i);

    fireEvent.input(odSph, { target: { value: "-2.00" } });
    fireEvent.blur(odSph);
    fireEvent.input(osSph, { target: { value: "-2.00" } });
    fireEvent.blur(osSph);
    fireEvent.input(pdInput, { target: { value: "63" } });
    fireEvent.blur(pdInput);

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => {
      expect((continueBtn as HTMLButtonElement).disabled).toBe(false);
    });

    await act(async () => {
      fireEvent.click(continueBtn);
    });

    // Form-level error is displayed with strings.apiErrors.VALIDATION_FAILED
    await waitFor(() => {
      expect(screen.getByText(strings.apiErrors.VALIDATION_FAILED)).not.toBeNull();
    });
    // No error under SPH
    const odSphInput = screen.getByLabelText(/Right eye.*Sphere/i);
    expect(odSphInput.getAttribute("aria-invalid")).toBe("false");
  });

  it("R2-F5: maps unknown od.* or os.* paths to form-level error submitError, not SPH", async () => {
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
          status: 400,
          code: "VALIDATION_FAILED",
          fields: [{ path: "od.prism", code: "UNSUPPORTED" }],
        }),
      ),
      getUploadUrl: vi.fn(),
      uploadFile: vi.fn(),
    };

    render(<TestWrapper initialState={state} api={mockApi} />);

    const odSph = screen.getByLabelText(/Right eye.*Sphere/i);
    const osSph = screen.getByLabelText(/Left eye.*Sphere/i);
    const pdInput = screen.getByLabelText(/PD \(mm\)/i);

    fireEvent.input(odSph, { target: { value: "-2.00" } });
    fireEvent.blur(odSph);
    fireEvent.input(osSph, { target: { value: "-2.00" } });
    fireEvent.blur(osSph);
    fireEvent.input(pdInput, { target: { value: "63" } });
    fireEvent.blur(pdInput);

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    await waitFor(() => {
      expect((continueBtn as HTMLButtonElement).disabled).toBe(false);
    });

    await act(async () => {
      fireEvent.click(continueBtn);
    });

    // Form-level error is displayed with strings.apiErrors.VALIDATION_FAILED
    await waitFor(() => {
      expect(screen.getByText(strings.apiErrors.VALIDATION_FAILED)).not.toBeNull();
    });

    // SPH is NOT marked invalid with error
    const odSphInput = screen.getByLabelText(/Right eye.*Sphere/i);
    expect(odSphInput.getAttribute("aria-invalid")).toBe("false");
    const odSphError = document.getElementById("od-sph-error");
    expect(odSphError?.hidden).toBe(true);
  });
});
