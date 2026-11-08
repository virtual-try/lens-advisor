import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "preact/hooks";
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

  // Sync isOpen prop changes into reducer only when the prop value changes
  const prevIsOpenRef = useRef(isOpen);
  useEffect(() => {
    if (isOpen !== prevIsOpenRef.current) {
      prevIsOpenRef.current = isOpen;
      if (isOpen) {
        dispatch({ type: "OPEN", frameVariantId: initialFrameVariantId });
      } else {
        dispatch({ type: "CLOSE" });
      }
    }
  }, [isOpen, initialFrameVariantId]);

  const handleClose = useCallback(() => {
    dispatch({ type: "CLOSE" });
    onClose?.();
  }, [onClose]);

  // Handle focus trap while open
  useEffect(() => {
    if (!state.isOpen || !sheetRef.current) return;

    const trap = createFocusTrap({
      container: sheetRef.current,
      trigger: triggerElement,
      onEscape: () => {
        handleClose();
      },
    });

    trap.activate();

    return () => {
      trap.deactivate();
    };
  }, [state.isOpen, triggerElement, handleClose]);

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

  if (!state.isOpen) {
    return null;
  }

  // Calculate applicable steps
  const applicableSteps = steps.filter((s) => s.isApplicable(state));
  const activeStep = steps[state.stepIndex];

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

  const showStepView = state.status === "ready" && activeStep && applicableSteps.length > 0;
  const showEmptyView =
    state.status === "empty" || (state.status === "ready" && applicableSteps.length === 0);

  return (
    <ApiContext.Provider value={api}>
      <div class="la-root">
        <style>{tokensCss}</style>
        <style>{shellCss}</style>
        <div class="la-overlay" onClick={handleBackdropClick}>
          <section
            class="la-sheet"
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
