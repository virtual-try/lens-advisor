import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import tokensCss from "../styles/tokens.css?inline";
import shellCss from "./shell.css?inline";
import { ApiContext, createApiClient, type ApiClient } from "../shared/api";
import { parseProductData, type ProductData, type ProductDataInput } from "../shared/types";
import { loadDiscoveredSteps } from "./discovery";
import { EmptyView } from "./EmptyView";
import { ErrorView } from "./ErrorView";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { LoadingView } from "./LoadingView";
import { configuratorReducer, createInitialState } from "./reducer";
import { createFocusTrap } from "./trap";
import type { ConfiguratorAction, ConfiguratorState, StepDefinition } from "./types";

function parseDurationFromCss(css: string, token: string): number {
  const match = css.match(new RegExp(`${token}:\\s*([0-9.]+)m?s`));
  if (!match) return 0;
  const val = parseFloat(match[1]);
  return match[0].includes("ms") ? val : val * 1000;
}

const DUR_FAST = parseDurationFromCss(tokensCss, "--la-dur-fast");
const DUR_MODAL = parseDurationFromCss(tokensCss, "--la-dur-modal");

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getExitDuration(el: HTMLElement | null): number {
  if (prefersReducedMotion()) {
    return 0;
  }
  const isMobile =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 40rem)").matches
      : false;
  const tokenName = isMobile ? "--la-dur-modal" : "--la-dur-fast";

  if (el && typeof window !== "undefined") {
    const computed = window.getComputedStyle(el).getPropertyValue(tokenName).trim();
    if (computed.endsWith("ms")) {
      const val = parseFloat(computed);
      if (!Number.isNaN(val) && val > 0) return val;
    } else if (computed.endsWith("s")) {
      const val = parseFloat(computed) * 1000;
      if (!Number.isNaN(val) && val > 0) return val;
    }
  }

  return isMobile ? DUR_MODAL : DUR_FAST;
}

export interface ConfiguratorAppProps {
  product?: ProductData | ProductDataInput;
  proxyBase?: string;
  steps?: StepDefinition[];
  apiClient?: ApiClient;
  isOpen?: boolean;
  onClose?: () => void;
  triggerElement?: HTMLElement | null;
  mountElement?: HTMLElement | null;
}

export function ConfiguratorApp({
  product,
  proxyBase = "/apps/lens-advisor",
  steps: providedSteps,
  apiClient,
  isOpen = true,
  onClose,
  triggerElement,
  mountElement,
}: ConfiguratorAppProps): JSX.Element | null {
  const safeProduct = useMemo(() => {
    return parseProductData(product);
  }, [product]);

  const steps = useMemo(() => {
    return providedSteps ?? loadDiscoveredSteps();
  }, [providedSteps]);

  const api = useMemo(() => {
    return apiClient ?? createApiClient({ proxyBase });
  }, [apiClient, proxyBase]);

  const sheetRef = useRef<HTMLElement | null>(null);

  const initialFrameVariantId =
    safeProduct?.variantId ||
    safeProduct?.variants?.[0]?.id ||
    safeProduct?.variantIds?.[0] ||
    "";

  const [state, dispatch] = useReducer<ConfiguratorState, ConfiguratorAction>(
    (s, a) => configuratorReducer(s, a, steps),
    {
      ...createInitialState(initialFrameVariantId),
      isOpen,
      status: isOpen ? "loading" : "idle",
    },
  );

  const [isExiting, setIsExiting] = useState(false);
  const isExitingRef = useRef(false);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerRef = useRef(triggerElement);
  triggerRef.current = triggerElement;

  const finishExit = useCallback(() => {
    if (exitTimeoutRef.current) {
      clearTimeout(exitTimeoutRef.current);
      exitTimeoutRef.current = null;
    }
    dispatch({ type: "CLOSE" });
    onClose?.();
    setIsExiting(false);
    isExitingRef.current = false;
    if (triggerRef.current && typeof triggerRef.current.focus === "function") {
      triggerRef.current.focus();
    }
  }, [onClose]);

  const handleClose = useCallback(() => {
    if (isExitingRef.current) return;

    if (prefersReducedMotion()) {
      finishExit();
      return;
    }

    isExitingRef.current = true;
    setIsExiting(true);

    const sheet = sheetRef.current;
    const duration = getExitDuration(sheet);

    exitTimeoutRef.current = setTimeout(() => {
      finishExit();
    }, duration);
  }, [finishExit]);

  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;

  // Listen for animationend and animationcancel on sheet during exit
  useEffect(() => {
    if (!isExiting || !sheetRef.current) return;

    const sheet = sheetRef.current;
    const handleAnimationEnd = (e: AnimationEvent) => {
      if (
        e.target === sheet ||
        (e.target as HTMLElement)?.classList.contains("la-overlay")
      ) {
        finishExit();
      }
    };

    sheet.addEventListener("animationend", handleAnimationEnd);
    sheet.addEventListener("animationcancel", handleAnimationEnd);

    return () => {
      sheet.removeEventListener("animationend", handleAnimationEnd);
      sheet.removeEventListener("animationcancel", handleAnimationEnd);
    };
  }, [isExiting, finishExit]);

  // Sync isOpen prop changes into reducer only when the prop value changes
  const prevIsOpenRef = useRef(isOpen);
  useEffect(() => {
    if (isOpen !== prevIsOpenRef.current) {
      prevIsOpenRef.current = isOpen;
      if (isOpen) {
        setIsExiting(false);
        isExitingRef.current = false;
        dispatch({ type: "OPEN", frameVariantId: initialFrameVariantId });
      } else {
        if (exitTimeoutRef.current) {
          clearTimeout(exitTimeoutRef.current);
          exitTimeoutRef.current = null;
        }
        setIsExiting(false);
        isExitingRef.current = false;
        dispatch({ type: "CLOSE" });
      }
    }
  }, [isOpen, initialFrameVariantId]);

  useEffect(() => {
    return () => {
      if (exitTimeoutRef.current) {
        clearTimeout(exitTimeoutRef.current);
        exitTimeoutRef.current = null;
      }
    };
  }, []);

  // Inert background content (host's body siblings) while open, restore exact prior state on close and disconnect
  useEffect(() => {
    if (!state.isOpen) return;

    const root = sheetRef.current?.getRootNode();
    const host = (
      root instanceof ShadowRoot
        ? root.host
        : sheetRef.current?.closest(".la-root") ?? sheetRef.current
    ) as HTMLElement | null;
    if (!host) return;

    let bodyChild: HTMLElement | null = host;
    while (bodyChild && bodyChild.parentElement && bodyChild.parentElement !== document.body) {
      bodyChild = bodyChild.parentElement;
    }
    const parent = bodyChild?.parentElement ?? (typeof document !== "undefined" ? document.body : null);
    if (!parent) return;

    const siblings = Array.from(parent.children).filter(
      (el): el is HTMLElement =>
        el !== bodyChild && !el.contains(bodyChild!) && el instanceof HTMLElement,
    );

    const saved = siblings.map((el) => ({
      el,
      inert: (el as HTMLElement & { inert?: boolean }).inert,
      hasInertAttr: el.hasAttribute("inert"),
      inertAttr: el.getAttribute("inert"),
      hasAriaHidden: el.hasAttribute("aria-hidden"),
      ariaHiddenAttr: el.getAttribute("aria-hidden"),
    }));

    for (const item of saved) {
      item.el.setAttribute("inert", "");
      if ("inert" in item.el) {
        (item.el as HTMLElement & { inert: boolean }).inert = true;
      }
      item.el.setAttribute("aria-hidden", "true");
    }

    return () => {
      for (const item of saved) {
        if ("inert" in item.el) {
          (item.el as HTMLElement & { inert?: boolean }).inert = item.inert;
        }
        if (item.hasInertAttr) {
          item.el.setAttribute("inert", item.inertAttr ?? "");
        } else {
          item.el.removeAttribute("inert");
        }
        if (item.hasAriaHidden && item.ariaHiddenAttr !== null) {
          item.el.setAttribute("aria-hidden", item.ariaHiddenAttr);
        } else {
          item.el.removeAttribute("aria-hidden");
        }
      }
    };
  }, [state.isOpen]);

  // Handle focus trap while open - stays active through exit phase until unmount
  useEffect(() => {
    if (!state.isOpen || !sheetRef.current) return;

    const trap = createFocusTrap({
      container: sheetRef.current,
      trigger: triggerElement,
      lockScroll: false,
      onEscape: () => {
        handleCloseRef.current();
      },
    });

    trap.activate();

    return () => {
      trap.deactivate();
    };
  }, [state.isOpen, triggerElement]);

  // Fetch catalog when open and status is loading
  useEffect(() => {
    if (!state.isOpen || state.status !== "loading") return;

    let cancelled = false;
    const prodId = safeProduct?.productId || safeProduct?.id;

    api
      .getCatalog(prodId)
      .then((catalog) => {
        if (cancelled) return;
        // If there are no discovered steps or no lens groups, it is empty state
        if (steps.length === 0 || !catalog.lensGroups || catalog.lensGroups.length === 0) {
          dispatch({
            type: "CATALOG_LOADED",
            catalog: {
              ...catalog,
              lensGroups: [],
            },
            steps,
          });
        } else {
          dispatch({ type: "CATALOG_LOADED", catalog, steps });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const errObj = err as { code?: string; message?: string };
        const code = errObj.code || "HTTP_ERROR";
        if (code === "NOT_AVAILABLE") {
          // Spec 21: Shop not installed or no active plan returns 404 NOT_AVAILABLE,
          // which maps to spec 16's empty state (no Retry) rather than a retryable error.
          dispatch({
            type: "CATALOG_ERROR",
            error: {
              code: "NOT_AVAILABLE",
              message: errObj.message,
            },
          });
        } else {
          dispatch({
            type: "CATALOG_ERROR",
            error: {
              code,
              message: errObj.message,
            },
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state.isOpen, state.status, safeProduct, api, steps]);

  const handleRetry = useCallback(() => {
    dispatch({ type: "CATALOG_LOADING" });
  }, []);

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!state.isOpen && !isExiting) {
    return null;
  }

  // Calculate applicable steps
  const applicableSteps = steps.filter((s) => s.isApplicable(state));
  const candidateStep = steps[state.stepIndex];
  const activeStep =
    candidateStep && candidateStep.isApplicable(state)
      ? candidateStep
      : applicableSteps[0];

  const applicableIndex = activeStep
    ? applicableSteps.findIndex((s) => s.id === activeStep.id)
    : -1;

  const canGoBack = applicableIndex > 0;
  const isCurrentComplete = activeStep ? activeStep.isComplete(state) : false;

  const handleBack = () => {
    dispatch({ type: "BACK", steps });
  };

  const handleContinue = () => {
    dispatch({ type: "CONTINUE", steps });
  };

  const showStepView =
    state.status === "ready" && activeStep && activeStep.isApplicable(state) && applicableSteps.length > 0;
  const showEmptyView =
    state.status === "empty" || (state.status === "ready" && applicableSteps.length === 0);

  return (
    <ApiContext.Provider value={api}>
      <div class="la-root">
        <style>{tokensCss}</style>
        <style>{shellCss}</style>
        <div
          class={`la-overlay${isExiting ? " la-overlay--exiting" : ""}`}
          onClick={handleBackdropClick}
        >
          <section
            class={`la-sheet${isExiting ? " la-sheet--exiting" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="la-dialog-title"
            ref={sheetRef}
          >
            <Header
              productTitle={safeProduct?.title}
              steps={applicableSteps}
              activeStep={activeStep}
              onClose={handleClose}
            />
            <div class="la-body">
              {state.status === "loading" && <LoadingView />}
              {state.status === "error" && <ErrorView onRetry={handleRetry} />}
              {showEmptyView && <EmptyView onClose={handleClose} />}
              {showStepView && (
                <activeStep.Component
                  state={state}
                  dispatch={dispatch}
                  api={api}
                  mount={mountElement}
                  product={safeProduct}
                  steps={steps}
                />
              )}
            </div>
            {showStepView && (
              <Footer
                state={state}
                dispatch={dispatch}
                api={api}
                activeStep={activeStep}
                canGoBack={canGoBack}
                isComplete={isCurrentComplete}
                mount={mountElement}
                product={safeProduct}
                onBack={handleBack}
                onContinue={handleContinue}
              />
            )}
          </section>
        </div>
      </div>
    </ApiContext.Provider>
  );
}
