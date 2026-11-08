import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import tokensCss from "../styles/tokens.css?inline";
import shellCss from "./shell.css?inline";
import { ApiContext, createApiClient, type ApiClient } from "../shared/api";
import type { ProductData } from "../shared/types";
import { loadDiscoveredSteps } from "./discovery";
import { EmptyView } from "./EmptyView";
import { ErrorView } from "./ErrorView";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { LoadingView } from "./LoadingView";
import { configuratorReducer, createInitialState } from "./reducer";
import { createFocusTrap } from "./trap";
import type { ConfiguratorAction, ConfiguratorState, StepDefinition } from "./types";

export interface ConfiguratorAppProps {
  product?: ProductData;
  proxyBase?: string;
  steps?: StepDefinition[];
  apiClient?: ApiClient;
  isOpen?: boolean;
  onClose?: () => void;
  triggerElement?: HTMLElement | null;
}

export function ConfiguratorApp({
  product,
  proxyBase = "/apps/lens-advisor",
  steps: providedSteps,
  apiClient,
  isOpen = true,
  onClose,
  triggerElement,
}: ConfiguratorAppProps): JSX.Element | null {
  const steps = useMemo(() => {
    return providedSteps ?? loadDiscoveredSteps();
  }, [providedSteps]);

  const api = useMemo(() => {
    return apiClient ?? createApiClient({ proxyBase });
  }, [apiClient, proxyBase]);

  const sheetRef = useRef<HTMLElement | null>(null);

  const initialFrameVariantId =
    product?.variantId || product?.variants?.[0]?.id || "";

  const [state, dispatch] = useReducer<ConfiguratorState, ConfiguratorAction>(
    (s, a) => configuratorReducer(s, a, steps),
    {
      ...createInitialState(initialFrameVariantId),
      isOpen,
      status: isOpen ? "loading" : "idle",
    },
  );

  const [isExiting, setIsExiting] = useState(false);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync isOpen prop changes into reducer only when the prop value changes
  const prevIsOpenRef = useRef(isOpen);
  useEffect(() => {
    if (isOpen !== prevIsOpenRef.current) {
      prevIsOpenRef.current = isOpen;
      if (isOpen) {
        setIsExiting(false);
        dispatch({ type: "OPEN", frameVariantId: initialFrameVariantId });
      } else {
        if (exitTimeoutRef.current) {
          clearTimeout(exitTimeoutRef.current);
          exitTimeoutRef.current = null;
        }
        setIsExiting(false);
        dispatch({ type: "CLOSE" });
      }
    }
  }, [isOpen, initialFrameVariantId]);

  const triggerRef = useRef(triggerElement);
  triggerRef.current = triggerElement;

  const handleClose = useCallback(() => {
    if (isExiting) return;
    setIsExiting(true);

    exitTimeoutRef.current = setTimeout(() => {
      dispatch({ type: "CLOSE" });
      onClose?.();
      setIsExiting(false);
      exitTimeoutRef.current = null;
      if (triggerRef.current && typeof triggerRef.current.focus === "function") {
        triggerRef.current.focus();
      }
    }, 250);
  }, [isExiting, onClose]);

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

  // Handle focus trap while open
  useEffect(() => {
    if (!state.isOpen || isExiting || !sheetRef.current) return;

    const trap = createFocusTrap({
      container: sheetRef.current,
      trigger: triggerElement,
      lockScroll: false,
      onEscape: () => {
        handleClose();
      },
    });

    trap.activate();

    return () => {
      trap.deactivate();
    };
  }, [state.isOpen, isExiting, triggerElement, handleClose]);

  // Fetch catalog when open and status is loading
  useEffect(() => {
    if (!state.isOpen || state.status !== "loading") return;

    let cancelled = false;
    const prodId = product?.productId || product?.id;

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
        dispatch({
          type: "CATALOG_ERROR",
          error: {
            code: errObj.code || "HTTP_ERROR",
            message: errObj.message,
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [state.isOpen, state.status, product, api, steps]);

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
              productTitle={product?.title}
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
