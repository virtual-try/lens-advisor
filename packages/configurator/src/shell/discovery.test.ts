import { describe, expect, it } from "vitest";
import { loadDiscoveredSteps } from "./discovery";

describe("step discovery", () => {
  it("sorts discovered steps by folder prefix", () => {
    const fakeModules = {
      "../steps/03-lens/index.tsx": {
        id: "lens",
        titleKey: "Lens",
        isComplete: () => true,
        isApplicable: () => true,
        Component: () => null,
      },
      "../steps/01-vision/index.tsx": {
        id: "vision",
        titleKey: "Vision",
        isComplete: () => true,
        isApplicable: () => true,
        Component: () => null,
      },
      "../steps/02-prescription/index.tsx": {
        id: "prescription",
        titleKey: "Prescription",
        isComplete: () => false,
        isApplicable: () => true,
        Component: () => null,
      },
    };

    const steps = loadDiscoveredSteps(fakeModules);
    expect(steps.map((s) => s.id)).toEqual(["vision", "prescription", "lens"]);
    expect(steps.map((s) => s.folder)).toEqual([
      "01-vision",
      "02-prescription",
      "03-lens",
    ]);
  });

  it("filters out invalid modules missing required contract", () => {
    const fakeModules = {
      "../steps/01-valid/index.tsx": {
        id: "valid",
        titleKey: "Valid",
        isComplete: () => true,
        isApplicable: () => true,
        Component: () => null,
      },
      "../steps/02-incomplete/index.tsx": {
        id: "no-component",
        titleKey: "No Component",
        isComplete: () => true,
        isApplicable: () => true,
      },
    };

    const steps = loadDiscoveredSteps(fakeModules);
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe("valid");
  });

  it("returns empty array when no step modules exist", () => {
    const steps = loadDiscoveredSteps({});
    expect(steps).toEqual([]);
  });
});
