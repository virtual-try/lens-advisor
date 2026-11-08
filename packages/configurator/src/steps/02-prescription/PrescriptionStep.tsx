import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  parseAddText,
  parseAxis,
  parseCylText,
  parsePd,
  parseSphText,
} from "../../../../rx-core/src/rx/parse.js";
import {
  validatePrescription,
  type RxValidationCode,
} from "../../../../rx-core/src/rx/validate.js";
import {
  formatAxis,
  formatDiopter,
  type Pd,
  type Prescription,
} from "../../../../rx-core/src/index.js";
import { ApiError } from "../../shared/api";
import type { StepProps } from "../../shell/types";
import { strings } from "./strings";
import prescriptionCss from "./prescription.css?inline";
import { registerPrescriptionSubmitHandler } from "./index";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "application/pdf",
]);

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "heic", "pdf"]);

function isFileTypeAllowed(file: File): boolean {
  if (file.type && file.type.trim().length > 0) {
    return ALLOWED_MIME_TYPES.has(file.type.toLowerCase());
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext ? ALLOWED_EXTENSIONS.has(ext) : false;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    const kb = Math.round(bytes / 1024);
    return `${kb} ${strings.upload.units.kb}`;
  }
  const tenths = Math.round((bytes * 10) / (1024 * 1024));
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return `${whole}.${frac} ${strings.upload.units.mb}`;
}

function mapPathToFieldKey(path: string): string | null {
  const normalized = path.replace(/^prescription\./, "");
  switch (normalized) {
    case "od.sph":
      return "odSph";
    case "od.cyl":
      return "odCyl";
    case "od.axis":
      return "odAxis";
    case "od.add":
      return "odAdd";
    case "os.sph":
      return "osSph";
    case "os.cyl":
      return "osCyl";
    case "os.axis":
      return "osAxis";
    case "os.add":
      return "osAdd";
    case "pd":
    case "pd.single":
      return "singlePd";
    case "pd.od":
      return "dualPdOd";
    case "pd.os":
      return "dualPdOs";
    default:
      return null;
  }
}

export function PrescriptionStep({ state, dispatch, api }: StepProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const manualEnabled = state.catalog?.settings?.manualRxEnabled !== false;
  const uploadEnabled = state.catalog?.settings?.rxUploadEnabled !== false;

  const initialRx = state.prescription;
  const hasUploadedFile = Boolean(!state.prescription && state.prescriptionRef);

  const showTabs = manualEnabled && uploadEnabled;
  const defaultTab = hasUploadedFile
    ? "upload"
    : manualEnabled
      ? "manual"
      : "upload";
  const [activeTab, setActiveTab] = useState<"manual" | "upload">(defaultTab);

  // Manual inputs (rehydrated from state.prescription)
  const [odSph, setOdSph] = useState(() =>
    initialRx?.od.sph !== undefined ? formatDiopter(initialRx.od.sph) : "",
  );
  const [odCyl, setOdCyl] = useState(() =>
    initialRx?.od.cyl !== undefined ? formatDiopter(initialRx.od.cyl) : "",
  );
  const [odAxis, setOdAxis] = useState(() =>
    initialRx?.od.axis !== undefined ? formatAxis(initialRx.od.axis) : "",
  );
  const [odAdd, setOdAdd] = useState(() =>
    initialRx?.od.add !== undefined ? formatDiopter(initialRx.od.add) : "",
  );

  const [osSph, setOsSph] = useState(() =>
    initialRx?.os.sph !== undefined ? formatDiopter(initialRx.os.sph) : "",
  );
  const [osCyl, setOsCyl] = useState(() =>
    initialRx?.os.cyl !== undefined ? formatDiopter(initialRx.os.cyl) : "",
  );
  const [osAxis, setOsAxis] = useState(() =>
    initialRx?.os.axis !== undefined ? formatAxis(initialRx.os.axis) : "",
  );
  const [osAdd, setOsAdd] = useState(() =>
    initialRx?.os.add !== undefined ? formatDiopter(initialRx.os.add) : "",
  );

  const [pdMode, setPdMode] = useState<"single" | "dual">(() => {
    if (initialRx?.pd && "od" in initialRx.pd) return "dual";
    return "single";
  });
  const [singlePd, setSinglePd] = useState(() => {
    if (initialRx?.pd && "single" in initialRx.pd) {
      return String(initialRx.pd.single / 10);
    }
    return "";
  });
  const [dualPdOd, setDualPdOd] = useState(() => {
    if (initialRx?.pd && "od" in initialRx.pd) {
      return String(initialRx.pd.od / 10);
    }
    return "";
  });
  const [dualPdOs, setDualPdOs] = useState(() => {
    if (initialRx?.pd && "os" in initialRx.pd) {
      return String(initialRx.pd.os / 10);
    }
    return "";
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Upload inputs (rehydrated if prescriptionRef exists without manual Rx)
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    size: string;
    key?: string;
  } | null>(() => {
    if (hasUploadedFile) {
      return {
        name: strings.upload.fileChip.onFile,
        size: "",
      };
    }
    return null;
  });

  const clearPrescriptionRef = useCallback(() => {
    if (state.prescriptionRef) {
      dispatch({ type: "SET_PRESCRIPTION_REF", prescriptionRef: "" });
    }
  }, [dispatch, state.prescriptionRef]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const isAddApplicable =
    state.rxType === "PROGRESSIVE" || state.rxType === "READING";

  // Build current prescription from inputs
  const buildPrescription = useCallback((): Prescription | null => {
    if (!odSph.trim() || !osSph.trim()) return null;

    const parsedOdSph = parseSphText(odSph);
    const parsedOsSph = parseSphText(osSph);
    if (!parsedOdSph.ok || !parsedOsSph.ok) return null;

    let odCylVal: number | undefined;
    if (odCyl.trim()) {
      const res = parseCylText(odCyl);
      if (!res.ok) return null;
      odCylVal = res.value;
    }

    let osCylVal: number | undefined;
    if (osCyl.trim()) {
      const res = parseCylText(osCyl);
      if (!res.ok) return null;
      osCylVal = res.value;
    }

    let odAxisVal: number | undefined;
    if (odCylVal !== undefined && odCylVal !== 0) {
      if (!odAxis.trim()) return null;
      const res = parseAxis(odAxis);
      if (!res.ok) return null;
      odAxisVal = res.value;
    }

    let osAxisVal: number | undefined;
    if (osCylVal !== undefined && osCylVal !== 0) {
      if (!osAxis.trim()) return null;
      const res = parseAxis(osAxis);
      if (!res.ok) return null;
      osAxisVal = res.value;
    }

    let odAddVal: number | undefined;
    let osAddVal: number | undefined;
    if (isAddApplicable) {
      if (!odAdd.trim() || !osAdd.trim()) return null;
      const parsedOdAdd = parseAddText(odAdd);
      const parsedOsAdd = parseAddText(osAdd);
      if (!parsedOdAdd.ok || !parsedOsAdd.ok) return null;
      odAddVal = parsedOdAdd.value;
      osAddVal = parsedOsAdd.value;
    }

    let pdVal: Pd;
    if (pdMode === "single") {
      if (!singlePd.trim()) return null;
      const res = parsePd(singlePd, { dual: false });
      if (!res.ok) return null;
      pdVal = { single: res.value };
    } else {
      if (!dualPdOd.trim() || !dualPdOs.trim()) return null;
      const parsedOd = parsePd(dualPdOd, { dual: true });
      const parsedOs = parsePd(dualPdOs, { dual: true });
      if (!parsedOd.ok || !parsedOs.ok) return null;
      pdVal = { od: parsedOd.value, os: parsedOs.value };
    }

    const rx: Prescription = {
      od: {
        sph: parsedOdSph.value,
        ...(odCylVal !== undefined ? { cyl: odCylVal } : {}),
        ...(odAxisVal !== undefined ? { axis: odAxisVal } : {}),
        ...(odAddVal !== undefined ? { add: odAddVal } : {}),
      },
      os: {
        sph: parsedOsSph.value,
        ...(osCylVal !== undefined ? { cyl: osCylVal } : {}),
        ...(osAxisVal !== undefined ? { axis: osAxisVal } : {}),
        ...(osAddVal !== undefined ? { add: osAddVal } : {}),
      },
      pd: pdVal,
    };

    const errors = validatePrescription(rx, state.rxType ?? "SINGLE_VISION");
    if (errors.length > 0) return null;

    return rx;
  }, [
    odSph,
    osSph,
    odCyl,
    osCyl,
    odAxis,
    osAxis,
    odAdd,
    osAdd,
    isAddApplicable,
    pdMode,
    singlePd,
    dualPdOd,
    dualPdOs,
    state.rxType,
  ]);

  const lastDispatchedRxRef = useRef<string | null>(null);

  // Sync valid prescription into shell state, or clear when invalid
  useEffect(() => {
    const rx = buildPrescription();
    const serialized = rx ? JSON.stringify(rx) : null;
    if (serialized !== lastDispatchedRxRef.current) {
      lastDispatchedRxRef.current = serialized;
      if (rx) {
        dispatch({ type: "SET_PRESCRIPTION", prescription: rx });
      } else {
        dispatch({ type: "CLEAR_PRESCRIPTION" });
      }
    }
  }, [buildPrescription, dispatch]);

  // Validation handlers on blur
  const validateField = (field: string) => {
    const newErrors = { ...fieldErrors };
    delete newErrors[field];

    if (field === "odSph") {
      if (odSph.trim()) {
        const res = parseSphText(odSph);
        if (!res.ok) {
          newErrors.odSph = strings.errors[res.error] || strings.errors.INVALID;
        }
      }
    } else if (field === "osSph") {
      if (osSph.trim()) {
        const res = parseSphText(osSph);
        if (!res.ok) {
          newErrors.osSph = strings.errors[res.error] || strings.errors.INVALID;
        }
      }
    } else if (field === "odCyl") {
      if (odCyl.trim()) {
        const res = parseCylText(odCyl);
        if (!res.ok) {
          newErrors.odCyl = strings.errors[res.error] || strings.errors.INVALID;
        } else if (res.value !== 0 && !odAxis.trim()) {
          newErrors.odAxis = strings.errors.AXIS_REQUIRED;
        } else if (res.value === 0 && newErrors.odAxis === strings.errors.AXIS_REQUIRED) {
          delete newErrors.odAxis;
        }
      } else {
        if (newErrors.odAxis === strings.errors.AXIS_REQUIRED) {
          delete newErrors.odAxis;
        }
      }
    } else if (field === "osCyl") {
      if (osCyl.trim()) {
        const res = parseCylText(osCyl);
        if (!res.ok) {
          newErrors.osCyl = strings.errors[res.error] || strings.errors.INVALID;
        } else if (res.value !== 0 && !osAxis.trim()) {
          newErrors.osAxis = strings.errors.AXIS_REQUIRED;
        } else if (res.value === 0 && newErrors.osAxis === strings.errors.AXIS_REQUIRED) {
          delete newErrors.osAxis;
        }
      } else {
        if (newErrors.osAxis === strings.errors.AXIS_REQUIRED) {
          delete newErrors.osAxis;
        }
      }
    } else if (field === "odAxis") {
      if (odAxis.trim()) {
        const res = parseAxis(odAxis);
        if (!res.ok) {
          newErrors.odAxis = strings.errors[res.error] || strings.errors.INVALID;
        }
      } else {
        const cylRes = parseCylText(odCyl);
        if (cylRes.ok && cylRes.value !== 0) {
          newErrors.odAxis = strings.errors.AXIS_REQUIRED;
        }
      }
    } else if (field === "osAxis") {
      if (osAxis.trim()) {
        const res = parseAxis(osAxis);
        if (!res.ok) {
          newErrors.osAxis = strings.errors[res.error] || strings.errors.INVALID;
        }
      } else {
        const cylRes = parseCylText(osCyl);
        if (cylRes.ok && cylRes.value !== 0) {
          newErrors.osAxis = strings.errors.AXIS_REQUIRED;
        }
      }
    } else if (field === "odAdd") {
      if (odAdd.trim()) {
        const res = parseAddText(odAdd);
        if (!res.ok) {
          newErrors.odAdd = strings.errors[res.error] || strings.errors.INVALID;
        }
      }
    } else if (field === "osAdd") {
      if (osAdd.trim()) {
        const res = parseAddText(osAdd);
        if (!res.ok) {
          newErrors.osAdd = strings.errors[res.error] || strings.errors.INVALID;
        }
      }
    } else if (field === "singlePd") {
      if (singlePd.trim()) {
        const res = parsePd(singlePd, { dual: false });
        if (!res.ok) {
          newErrors.singlePd = strings.errors[res.error] || strings.errors.INVALID;
        }
      }
    } else if (field === "dualPdOd") {
      if (dualPdOd.trim()) {
        const res = parsePd(dualPdOd, { dual: true });
        if (!res.ok) {
          newErrors.dualPdOd = strings.errors[res.error] || strings.errors.INVALID;
        }
      }
    } else if (field === "dualPdOs") {
      if (dualPdOs.trim()) {
        const res = parsePd(dualPdOs, { dual: true });
        if (!res.ok) {
          newErrors.dualPdOs = strings.errors[res.error] || strings.errors.INVALID;
        }
      }
    }

    setFieldErrors(newErrors);
  };

  const handleCopyEye = () => {
    clearPrescriptionRef();
    setOsSph(odSph);
    setOsCyl(odCyl);
    setOsAxis(odAxis);
    setOsAdd(odAdd);
    const newErrors = { ...fieldErrors };
    delete newErrors.osSph;
    delete newErrors.osCyl;
    delete newErrors.osAxis;
    delete newErrors.osAdd;
    if (fieldErrors.odSph) newErrors.osSph = fieldErrors.odSph;
    if (fieldErrors.odCyl) newErrors.osCyl = fieldErrors.odCyl;
    if (fieldErrors.odAxis) newErrors.osAxis = fieldErrors.odAxis;
    if (fieldErrors.odAdd) newErrors.osAdd = fieldErrors.odAdd;
    setFieldErrors(newErrors);
  };

  const handleManualSubmit = useCallback(async () => {
    setSubmitError(null);
    const rx = buildPrescription();
    if (!rx) {
      // Trigger all validations to show errors
      const errs: Record<string, string> = {};
      if (!odSph.trim()) errs.odSph = strings.errors.SPH_REQUIRED;
      else {
        const res = parseSphText(odSph);
        if (!res.ok) errs.odSph = strings.errors[res.error] || strings.errors.INVALID;
      }
      if (!osSph.trim()) errs.osSph = strings.errors.SPH_REQUIRED;
      else {
        const res = parseSphText(osSph);
        if (!res.ok) errs.osSph = strings.errors[res.error] || strings.errors.INVALID;
      }

      if (odCyl.trim()) {
        const res = parseCylText(odCyl);
        if (!res.ok) errs.odCyl = strings.errors[res.error] || strings.errors.INVALID;
        else if (res.value !== 0 && !odAxis.trim()) errs.odAxis = strings.errors.AXIS_REQUIRED;
      }
      if (osCyl.trim()) {
        const res = parseCylText(osCyl);
        if (!res.ok) errs.osCyl = strings.errors[res.error] || strings.errors.INVALID;
        else if (res.value !== 0 && !osAxis.trim()) errs.osAxis = strings.errors.AXIS_REQUIRED;
      }

      if (odAxis.trim()) {
        const res = parseAxis(odAxis);
        if (!res.ok) errs.odAxis = strings.errors[res.error] || strings.errors.INVALID;
      }
      if (osAxis.trim()) {
        const res = parseAxis(osAxis);
        if (!res.ok) errs.osAxis = strings.errors[res.error] || strings.errors.INVALID;
      }

      if (isAddApplicable) {
        if (!odAdd.trim()) errs.odAdd = strings.errors.ADD_REQUIRED;
        else {
          const res = parseAddText(odAdd);
          if (!res.ok) errs.odAdd = strings.errors[res.error] || strings.errors.INVALID;
        }
        if (!osAdd.trim()) errs.osAdd = strings.errors.ADD_REQUIRED;
        else {
          const res = parseAddText(osAdd);
          if (!res.ok) errs.osAdd = strings.errors[res.error] || strings.errors.INVALID;
        }
      }

      if (pdMode === "single") {
        if (!singlePd.trim()) errs.singlePd = strings.errors.PD_REQUIRED;
        else {
          const res = parsePd(singlePd, { dual: false });
          if (!res.ok) errs.singlePd = strings.errors[res.error] || strings.errors.INVALID;
        }
      } else {
        if (!dualPdOd.trim()) errs.dualPdOd = strings.errors.PD_REQUIRED;
        else {
          const res = parsePd(dualPdOd, { dual: true });
          if (!res.ok) errs.dualPdOd = strings.errors[res.error] || strings.errors.INVALID;
        }
        if (!dualPdOs.trim()) errs.dualPdOs = strings.errors.PD_REQUIRED;
        else {
          const res = parsePd(dualPdOs, { dual: true });
          if (!res.ok) errs.dualPdOs = strings.errors[res.error] || strings.errors.INVALID;
        }
      }

      setFieldErrors(errs);
      return;
    }

    try {
      const res = await api.submitPrescription({
        rxType: state.rxType ?? "SINGLE_VISION",
        prescription: rx,
      });
      dispatch({ type: "SET_PRESCRIPTION_REF", prescriptionRef: res.rxRef });
      dispatch({ type: "CONTINUE" });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 400 && err.fields && err.fields.length > 0) {
        const errs: Record<string, string> = {};
        let hasUnmappedField = false;
        for (const f of err.fields) {
          const key = mapPathToFieldKey(f.path);
          if (key) {
            const codeKey = f.code as RxValidationCode;
            errs[key] = strings.errors[codeKey] || strings.errors.GENERIC || strings.errors.INVALID;
          } else {
            hasUnmappedField = true;
          }
        }
        if (Object.keys(errs).length > 0) {
          setFieldErrors((prev) => ({ ...prev, ...errs }));
        }
        if (hasUnmappedField || Object.keys(errs).length === 0) {
          setSubmitError(strings.apiErrors.VALIDATION_FAILED);
        }
      } else {
        const apiCode = err instanceof ApiError ? (err.code as keyof typeof strings.apiErrors) : undefined;
        setSubmitError(
          (apiCode && strings.apiErrors[apiCode]) || strings.errors.SUBMIT_FAILED,
        );
      }
    }
  }, [
    api,
    buildPrescription,
    dispatch,
    isAddApplicable,
    odAdd,
    odAxis,
    odCyl,
    odSph,
    osAdd,
    osAxis,
    osCyl,
    osSph,
    pdMode,
    singlePd,
    dualPdOd,
    dualPdOs,
    state.rxType,
  ]);

  // Handle file upload
  const handleUploadFile = async (file: File) => {
    clearPrescriptionRef();
    setUploadError(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError(strings.upload.errors.fileTooLarge);
      return;
    }

    if (!isFileTypeAllowed(file)) {
      setUploadError(strings.upload.errors.invalidType);
      return;
    }

    try {
      setIsUploading(true);
      const urlRes = await api.getUploadUrl(file);
      await api.uploadFile(urlRes.uploadUrl, file);
      const submitRes = await api.submitPrescription({
        rxType: state.rxType ?? "SINGLE_VISION",
        uploadedKeys: [urlRes.key],
        draftId: urlRes.draftId,
      });
      setUploadedFile({
        name: file.name,
        size: formatFileSize(file.size),
        key: urlRes.key,
      });
      dispatch({ type: "SET_PRESCRIPTION_REF", prescriptionRef: submitRes.rxRef });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        const apiCode = err.code as keyof typeof strings.apiErrors;
        setUploadError(strings.apiErrors[apiCode] || strings.upload.errors.uploadFailed);
      } else {
        setUploadError(strings.upload.errors.uploadFailed);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveFile = () => {
    setUploadedFile(null);
    setUploadError(null);
    dispatch({ type: "SET_PRESCRIPTION_REF", prescriptionRef: "" });
  };

  // Register submit handler with step definition so shell onContinue calls it
  useEffect(() => {
    registerPrescriptionSubmitHandler(handleManualSubmit);
    return () => {
      registerPrescriptionSubmitHandler(null);
    };
  }, [handleManualSubmit]);

  return (
    <div class="la-step-prescription" ref={containerRef}>
      <style>{prescriptionCss}</style>
      <div class="la-step-head">
        <h2>{strings.title}</h2>
        <p>{strings.subtitle}</p>
      </div>

      {showTabs && (
        <div class="la-tabs" role="tablist" aria-label={strings.tabs.ariaLabel}>
          <button
            type="button"
            class="la-tab"
            role="tab"
            id="tab-manual"
            aria-controls="panel-manual"
            aria-selected={activeTab === "manual"}
            onClick={() => setActiveTab("manual")}
          >
            {strings.tabs.manual}
          </button>
          <button
            type="button"
            class="la-tab"
            role="tab"
            id="tab-upload"
            aria-controls="panel-upload"
            aria-selected={activeTab === "upload"}
            onClick={() => setActiveTab("upload")}
          >
            {strings.tabs.upload}
          </button>
        </div>
      )}

      {/* Manual tab panel */}
      {manualEnabled && (
        <div
          class="la-tabpanel"
          role="tabpanel"
          id="panel-manual"
          aria-labelledby="tab-manual"
          hidden={activeTab !== "manual"}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleManualSubmit();
            }}
          >
            <div class="la-rx">
              <div class="la-rx__head">
                <span />
                <span class="la-rx__eye" id="eye-od">
                  {strings.grid.rightEye}{" "}
                  <small>({strings.grid.rightEyeShort})</small>
                </span>
                <span class="la-rx__eye" id="eye-os">
                  {strings.grid.leftEye}{" "}
                  <small>({strings.grid.leftEyeShort})</small>
                </span>
              </div>

              {/* Sphere row */}
              <div class="la-rx__row">
                <div class="la-rx__label" id="lbl-sph">
                  <strong id="lbl-sph-title">{strings.grid.sphere}</strong>
                  <span>{strings.grid.sphereDesc}</span>
                </div>
                <div class="la-rx__cell">
                  <input
                    class="la-control"
                    id="od-sph"
                    type="text"
                    inputmode="decimal"
                    value={odSph}
                    onInput={(e) => {
                      setOdSph((e.target as HTMLInputElement).value);
                      clearPrescriptionRef();
                    }}
                    onBlur={() => validateField("odSph")}
                    aria-labelledby="eye-od lbl-sph-title"
                    aria-describedby="od-sph-error"
                    aria-invalid={Boolean(fieldErrors.odSph)}
                  />
                  <p class="la-error" id="od-sph-error" role="alert" hidden={!fieldErrors.odSph}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" />
                      <path d="M8 4.6v4.2M8 11.2v.1" stroke-linecap="round" />
                    </svg>
                    <span>{fieldErrors.odSph}</span>
                  </p>
                </div>
                <div class="la-rx__cell">
                  <input
                    class="la-control"
                    id="os-sph"
                    type="text"
                    inputmode="decimal"
                    value={osSph}
                    onInput={(e) => {
                      setOsSph((e.target as HTMLInputElement).value);
                      clearPrescriptionRef();
                    }}
                    onBlur={() => validateField("osSph")}
                    aria-labelledby="eye-os lbl-sph-title"
                    aria-describedby="os-sph-error"
                    aria-invalid={Boolean(fieldErrors.osSph)}
                  />
                  <p class="la-error" id="os-sph-error" role="alert" hidden={!fieldErrors.osSph}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" />
                      <path d="M8 4.6v4.2M8 11.2v.1" stroke-linecap="round" />
                    </svg>
                    <span>{fieldErrors.osSph}</span>
                  </p>
                </div>
              </div>

              {/* Cylinder row */}
              <div class="la-rx__row">
                <div class="la-rx__label" id="lbl-cyl">
                  <strong id="lbl-cyl-title">{strings.grid.cylinder}</strong>
                  <span>{strings.grid.cylinderDesc}</span>
                </div>
                <div class="la-rx__cell">
                  <input
                    class="la-control"
                    id="od-cyl"
                    type="text"
                    inputmode="decimal"
                    value={odCyl}
                    onInput={(e) => {
                      setOdCyl((e.target as HTMLInputElement).value);
                      clearPrescriptionRef();
                    }}
                    onBlur={() => validateField("odCyl")}
                    aria-labelledby="eye-od lbl-cyl-title"
                    aria-describedby="od-cyl-error"
                    aria-invalid={Boolean(fieldErrors.odCyl)}
                  />
                  <p class="la-error" id="od-cyl-error" role="alert" hidden={!fieldErrors.odCyl}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" />
                      <path d="M8 4.6v4.2M8 11.2v.1" stroke-linecap="round" />
                    </svg>
                    <span>{fieldErrors.odCyl}</span>
                  </p>
                </div>
                <div class="la-rx__cell">
                  <input
                    class="la-control"
                    id="os-cyl"
                    type="text"
                    inputmode="decimal"
                    value={osCyl}
                    onInput={(e) => {
                      setOsCyl((e.target as HTMLInputElement).value);
                      clearPrescriptionRef();
                    }}
                    onBlur={() => validateField("osCyl")}
                    aria-labelledby="eye-os lbl-cyl-title"
                    aria-describedby="os-cyl-error"
                    aria-invalid={Boolean(fieldErrors.osCyl)}
                  />
                  <p class="la-error" id="os-cyl-error" role="alert" hidden={!fieldErrors.osCyl}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" />
                      <path d="M8 4.6v4.2M8 11.2v.1" stroke-linecap="round" />
                    </svg>
                    <span>{fieldErrors.osCyl}</span>
                  </p>
                </div>
              </div>

              {/* Axis row */}
              <div class="la-rx__row">
                <div class="la-rx__label" id="lbl-axis">
                  <strong id="lbl-axis-title">{strings.grid.axis}</strong>
                  <span>{strings.grid.axisDesc}</span>
                </div>
                <div class="la-rx__cell">
                  <input
                    class="la-control"
                    id="od-axis"
                    type="text"
                    inputmode="numeric"
                    maxLength={3}
                    value={odAxis}
                    onInput={(e) => {
                      setOdAxis((e.target as HTMLInputElement).value);
                      clearPrescriptionRef();
                    }}
                    onBlur={() => validateField("odAxis")}
                    aria-labelledby="eye-od lbl-axis-title"
                    aria-describedby="od-axis-error"
                    aria-invalid={Boolean(fieldErrors.odAxis)}
                  />
                  <p class="la-error" id="od-axis-error" role="alert" hidden={!fieldErrors.odAxis}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" />
                      <path d="M8 4.6v4.2M8 11.2v.1" stroke-linecap="round" />
                    </svg>
                    <span>{fieldErrors.odAxis}</span>
                  </p>
                </div>
                <div class="la-rx__cell">
                  <input
                    class="la-control"
                    id="os-axis"
                    type="text"
                    inputmode="numeric"
                    maxLength={3}
                    value={osAxis}
                    onInput={(e) => {
                      setOsAxis((e.target as HTMLInputElement).value);
                      clearPrescriptionRef();
                    }}
                    onBlur={() => validateField("osAxis")}
                    aria-labelledby="eye-os lbl-axis-title"
                    aria-describedby="os-axis-error"
                    aria-invalid={Boolean(fieldErrors.osAxis)}
                  />
                  <p class="la-error" id="os-axis-error" role="alert" hidden={!fieldErrors.osAxis}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" />
                      <path d="M8 4.6v4.2M8 11.2v.1" stroke-linecap="round" />
                    </svg>
                    <span>{fieldErrors.osAxis}</span>
                  </p>
                </div>
              </div>

              {/* Add row - only for progressive/reading */}
              {isAddApplicable && (
                <div class="la-rx__row">
                  <div class="la-rx__label" id="lbl-add">
                    <strong id="lbl-add-title">{strings.grid.add}</strong>
                    <span>{strings.grid.addDesc}</span>
                  </div>
                  <div class="la-rx__cell">
                    <input
                      class="la-control"
                      id="od-add"
                      type="text"
                      inputmode="decimal"
                      value={odAdd}
                      onInput={(e) => {
                        setOdAdd((e.target as HTMLInputElement).value);
                        clearPrescriptionRef();
                      }}
                      onBlur={() => validateField("odAdd")}
                      aria-labelledby="eye-od lbl-add-title"
                      aria-describedby="od-add-error"
                      aria-invalid={Boolean(fieldErrors.odAdd)}
                    />
                    <p class="la-error" id="od-add-error" role="alert" hidden={!fieldErrors.odAdd}>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                        <circle cx="8" cy="8" r="6.5" />
                        <path d="M8 4.6v4.2M8 11.2v.1" stroke-linecap="round" />
                      </svg>
                      <span>{fieldErrors.odAdd}</span>
                    </p>
                  </div>
                  <div class="la-rx__cell">
                    <input
                      class="la-control"
                      id="os-add"
                      type="text"
                      inputmode="decimal"
                      value={osAdd}
                      onInput={(e) => {
                        setOsAdd((e.target as HTMLInputElement).value);
                        clearPrescriptionRef();
                      }}
                      onBlur={() => validateField("osAdd")}
                      aria-labelledby="eye-os lbl-add-title"
                      aria-describedby="os-add-error"
                      aria-invalid={Boolean(fieldErrors.osAdd)}
                    />
                    <p class="la-error" id="os-add-error" role="alert" hidden={!fieldErrors.osAdd}>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                        <circle cx="8" cy="8" r="6.5" />
                        <path d="M8 4.6v4.2M8 11.2v.1" stroke-linecap="round" />
                      </svg>
                      <span>{fieldErrors.osAdd}</span>
                    </p>
                  </div>
                </div>
              )}
            </div>

            <button
              class="la-link la-copy"
              type="button"
              onClick={handleCopyEye}
            >
              {strings.grid.copyToLeft}
            </button>

            {/* PD section */}
            <fieldset class="la-pd">
              <legend class="la-section__title">{strings.pd.legend}</legend>
              <p class="la-section__hint">{strings.pd.hint}</p>
              <div class="la-segment">
                <label>
                  <input
                    type="radio"
                    name="pd-mode"
                    value="single"
                    checked={pdMode === "single"}
                    onChange={() => {
                      clearPrescriptionRef();
                      setPdMode("single");
                      const errs = { ...fieldErrors };
                      delete errs.dualPdOd;
                      delete errs.dualPdOs;
                      setFieldErrors(errs);
                    }}
                  />
                  {strings.pd.singleMode}
                </label>
                <label>
                  <input
                    type="radio"
                    name="pd-mode"
                    value="dual"
                    checked={pdMode === "dual"}
                    onChange={() => {
                      clearPrescriptionRef();
                      setPdMode("dual");
                      const errs = { ...fieldErrors };
                      delete errs.singlePd;
                      setFieldErrors(errs);
                    }}
                  />
                  {strings.pd.dualMode}
                </label>
              </div>

              <div class="la-pd__fields">
                {pdMode === "single" ? (
                  <div class="la-pd__field">
                    <label for="pd-single" class="la-pd__label" id="lbl-pd-single">
                      {strings.pd.singleLabel}
                    </label>
                    <input
                      class="la-control"
                      id="pd-single"
                      type="text"
                      inputmode="decimal"
                      value={singlePd}
                      onInput={(e) => {
                        setSinglePd((e.target as HTMLInputElement).value);
                        clearPrescriptionRef();
                      }}
                      onBlur={() => validateField("singlePd")}
                      aria-describedby="pd-single-error"
                      aria-invalid={Boolean(fieldErrors.singlePd)}
                    />
                    <p class="la-error" id="pd-single-error" role="alert" hidden={!fieldErrors.singlePd}>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                        <circle cx="8" cy="8" r="6.5" />
                        <path d="M8 4.6v4.2M8 11.2v.1" stroke-linecap="round" />
                      </svg>
                      <span>{fieldErrors.singlePd}</span>
                    </p>
                  </div>
                ) : (
                  <>
                    <div class="la-pd__field">
                      <label for="pd-od" class="la-pd__label" id="lbl-pd-od">
                        {strings.pd.dualRightLabel}
                      </label>
                      <input
                        class="la-control"
                        id="pd-od"
                        type="text"
                        inputmode="decimal"
                        value={dualPdOd}
                        onInput={(e) => {
                          setDualPdOd((e.target as HTMLInputElement).value);
                          clearPrescriptionRef();
                        }}
                        onBlur={() => validateField("dualPdOd")}
                        aria-describedby="pd-od-error"
                        aria-invalid={Boolean(fieldErrors.dualPdOd)}
                      />
                      <p class="la-error" id="pd-od-error" role="alert" hidden={!fieldErrors.dualPdOd}>
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                          <circle cx="8" cy="8" r="6.5" />
                          <path d="M8 4.6v4.2M8 11.2v.1" stroke-linecap="round" />
                        </svg>
                        <span>{fieldErrors.dualPdOd}</span>
                      </p>
                    </div>
                    <div class="la-pd__field">
                      <label for="pd-os" class="la-pd__label" id="lbl-pd-os">
                        {strings.pd.dualLeftLabel}
                      </label>
                      <input
                        class="la-control"
                        id="pd-os"
                        type="text"
                        inputmode="decimal"
                        value={dualPdOs}
                        onInput={(e) => {
                          setDualPdOs((e.target as HTMLInputElement).value);
                          clearPrescriptionRef();
                        }}
                        onBlur={() => validateField("dualPdOs")}
                        aria-describedby="pd-os-error"
                        aria-invalid={Boolean(fieldErrors.dualPdOs)}
                      />
                      <p class="la-error" id="pd-os-error" role="alert" hidden={!fieldErrors.dualPdOs}>
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                          <circle cx="8" cy="8" r="6.5" />
                          <path d="M8 4.6v4.2M8 11.2v.1" stroke-linecap="round" />
                        </svg>
                        <span>{fieldErrors.dualPdOs}</span>
                      </p>
                    </div>
                  </>
                )}
              </div>
            </fieldset>

            {submitError && (
              <p class="la-error" role="alert">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M8 4.6v4.2M8 11.2v.1" stroke-linecap="round" />
                </svg>
                <span>{submitError}</span>
              </p>
            )}
          </form>

          {/* Help disclosure */}
          <details class="la-help">
            <summary>{strings.help.summary}</summary>
            <dl>
              <div>
                <dt>{strings.help.sphereTitle}</dt>
                <dd>{strings.help.sphereDesc}</dd>
              </div>
              <div>
                <dt>{strings.help.cylAxisTitle}</dt>
                <dd>{strings.help.cylAxisDesc}</dd>
              </div>
              <div>
                <dt>{strings.help.addTitle}</dt>
                <dd>{strings.help.addDesc}</dd>
              </div>
              <div>
                <dt>{strings.help.pdTitle}</dt>
                <dd>{strings.help.pdDesc}</dd>
              </div>
            </dl>
          </details>
        </div>
      )}

      {/* Upload tab panel */}
      {uploadEnabled && (
        <div
          class="la-tabpanel"
          role="tabpanel"
          id="panel-upload"
          aria-labelledby="tab-upload"
          hidden={activeTab !== "upload"}
        >
          <p class="la-note">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
              <rect x="4" y="9" width="12" height="8" rx="2" />
              <path d="M7 9V6.5a3 3 0 016 0V9" />
            </svg>
            <span>{strings.upload.privacyNote}</span>
          </p>

          <div
            class={`la-drop${isDragOver ? " la-drop--active" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              const file = e.dataTransfer?.files?.[0];
              if (file) {
                handleUploadFile(file);
              }
            }}
          >
            <svg class="la-drop__icon" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <rect x="7" y="5" width="26" height="30" rx="4" />
              <path d="M20 26V14M15 18.5l5-5 5 5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <p class="la-drop__title">{strings.upload.dropTitle}</p>
            <p class="la-drop__hint">
              <span class="la-drop__desktop-only">{strings.upload.dropHintDesktop}</span>
            </p>
            <div class="la-drop__actions">
              <label class="la-btn la-btn--ghost">
                <span>{uploadedFile ? strings.upload.replaceFile : strings.upload.chooseFile}</span>
                <input
                  ref={fileInputRef}
                  class="la-sr"
                  type="file"
                  accept="image/jpeg,image/png,image/heic,application/pdf"
                  onChange={(e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) {
                      handleUploadFile(file);
                    }
                  }}
                />
              </label>
              <label class="la-btn la-btn--ghost">
                <span>{strings.upload.takePhoto}</span>
                <input
                  ref={cameraInputRef}
                  class="la-sr"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) {
                      handleUploadFile(file);
                    }
                  }}
                />
              </label>
            </div>
          </div>

          {uploadError && (
            <p class="la-error" id="upload-error" role="alert">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M8 4.6v4.2M8 11.2v.1" stroke-linecap="round" />
              </svg>
              <span>{uploadError}</span>
            </p>
          )}

          {isUploading && (
            <div class="la-upload-progress" role="status">
              <progress
                class="la-progress"
                aria-label={strings.upload.progressLabel}
              />
              <span>{strings.upload.uploading}</span>
            </div>
          )}

          {uploadedFile && (
            <div class="la-file">
              <svg class="la-file__icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                <path d="M5 2.5h6.5L15 6v11.5H5z" />
                <path d="M11.5 2.5V6H15" />
              </svg>
              <span class="la-file__name">{uploadedFile.name}</span>
              <span class="la-file__size">{uploadedFile.size}</span>
              <button
                class="la-iconbtn"
                type="button"
                aria-label={`${strings.upload.removeLabel} ${uploadedFile.name}`}
                onClick={handleRemoveFile}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          )}

          <p class="la-section__hint">{strings.upload.pdHint}</p>
        </div>
      )}
    </div>
  );
}
