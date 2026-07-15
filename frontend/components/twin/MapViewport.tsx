"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import styles from "./MapViewport.module.css";

export const MAP_VIEWBOX = { width: 2600, height: 2000 } as const;
/** Rendered world size in CSS pixels (matches SVG aspect). */
export const MAP_WORLD = { width: 2600, height: 2000 } as const;

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
/** Soft zoom per physical mouse-wheel notch (~8%). */
const MOUSE_WHEEL_FACTOR = 1.08;
/** Pinch / ctrl+wheel sensitivity (lower = gentler). */
const PINCH_SENSITIVITY = 0.0018;
/** Keep assets clear of the right assessment drawer when focusing. */
const FOCUS_RIGHT_PAD = 400;
/** Breathing room around an asset when fitting it into view. */
const FOCUS_PADDING_PX = 72;
/**
 * Fraction of the max-fit zoom to use when focusing an asset.
 * 1 = fill the clear viewport; lower keeps surrounding context.
 */
const FOCUS_FRAME = 0.48;
/** Cap how far in we zoom for tiny assets. */
const MAX_FOCUS_ZOOM = 1.55;
/** Point-only focus: mild zoom-in relative to the overview fit. */
const POINT_FOCUS_RELATIVE = 1.55;
/** Leave a little margin when fitting the full map. */
const FIT_MARGIN = 0.94;

export interface MapPoint {
  x: number;
  y: number;
}

export interface MapBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FocusOptions {
  /** Explicit zoom level (viewBox/world units). */
  zoom?: number;
  /** When set, zoom so this region fits the clear viewport. */
  bounds?: MapBounds;
}

export interface MapViewportHandle {
  focusOn: (point: MapPoint, zoomOrOptions?: number | FocusOptions) => void;
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getZoom: () => number;
}

interface MapViewportProps {
  children: ReactNode;
  className?: string;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function viewBoxToWorld(point: MapPoint): MapPoint {
  return {
    x: (point.x / MAP_VIEWBOX.width) * MAP_WORLD.width,
    y: (point.y / MAP_VIEWBOX.height) * MAP_WORLD.height,
  };
}

function viewBoxSizeToWorld(w: number, h: number): { w: number; h: number } {
  return {
    w: (w / MAP_VIEWBOX.width) * MAP_WORLD.width,
    h: (h / MAP_VIEWBOX.height) * MAP_WORLD.height,
  };
}

function computeFitScale(viewportW: number, viewportH: number): number {
  return clamp(
    Math.min(viewportW / MAP_WORLD.width, viewportH / MAP_WORLD.height) *
      FIT_MARGIN,
    MIN_ZOOM,
    MAX_ZOOM,
  );
}

/** Discrete mouse wheel vs continuous trackpad two-finger scroll. */
function isLikelyMouseWheel(event: WheelEvent): boolean {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return true;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return true;
  return Math.abs(event.deltaY) >= 40;
}

function normalizeFocusOptions(
  zoomOrOptions?: number | FocusOptions,
): FocusOptions {
  if (typeof zoomOrOptions === "number") return { zoom: zoomOrOptions };
  return zoomOrOptions ?? {};
}

export const MapViewport = forwardRef<MapViewportHandle, MapViewportProps>(
  function MapViewport({ children, className }, ref) {
    const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const didFitInit = useRef(false);
    const [ready, setReady] = useState(false);

    const applyFitView = useCallback((animated: boolean) => {
      const api = transformRef.current;
      const wrapper = wrapperRef.current;
      if (!api || !wrapper) return;

      const { width, height } = wrapper.getBoundingClientRect();
      if (width < 1 || height < 1) return;

      const scale = computeFitScale(width, height);
      const positionX = (width - MAP_WORLD.width * scale) / 2;
      const positionY = (height - MAP_WORLD.height * scale) / 2;
      api.setTransform(
        positionX,
        positionY,
        scale,
        animated ? 280 : 0,
        "easeOutCubic",
      );
    }, []);

    const focusOn = useCallback(
      (point: MapPoint, zoomOrOptions?: number | FocusOptions) => {
        const api = transformRef.current;
        const wrapper = wrapperRef.current;
        if (!api || !wrapper) return;

        const { width, height } = wrapper.getBoundingClientRect();
        if (width < 1 || height < 1) return;

        const options = normalizeFocusOptions(zoomOrOptions);
        const rightPad = Math.min(FOCUS_RIGHT_PAD, width * 0.45);
        const availW = Math.max(width - rightPad, width * 0.55);
        const fitScale = computeFitScale(width, height);

        let scale: number;
        if (options.zoom != null) {
          scale = clamp(options.zoom, MIN_ZOOM, MAX_ZOOM);
        } else if (options.bounds && options.bounds.w > 0 && options.bounds.h > 0) {
          const size = viewBoxSizeToWorld(options.bounds.w, options.bounds.h);
          const pad = FOCUS_PADDING_PX * 2;
          // Ceiling: largest scale where the asset still fits in the clear area.
          const maxFit = Math.min(
            (availW - pad) / Math.max(size.w, 1),
            (height - pad) / Math.max(size.h, 1),
          );
          if (maxFit <= fitScale) {
            // Large zone: just fit it with padding — don't pull further out.
            scale = clamp(maxFit, MIN_ZOOM, MAX_ZOOM);
          } else {
            // Smaller assets: gentle zoom-in, well under a full-viewport fill.
            scale = clamp(
              maxFit * FOCUS_FRAME,
              fitScale,
              Math.min(maxFit, MAX_FOCUS_ZOOM),
            );
          }
        } else {
          // Point-only: gentle zoom-in relative to the overview fit.
          scale = clamp(
            fitScale * POINT_FOCUS_RELATIVE,
            MIN_ZOOM,
            Math.min(MAX_ZOOM, MAX_FOCUS_ZOOM),
          );
        }

        const world = viewBoxToWorld(
          options.bounds
            ? {
                x: options.bounds.x + options.bounds.w / 2,
                y: options.bounds.y + options.bounds.h / 2,
              }
            : point,
        );
        const positionX = availW / 2 - world.x * scale;
        const positionY = height / 2 - world.y * scale;
        api.setTransform(positionX, positionY, scale, 280, "easeOutCubic");
      },
      [],
    );

    const resetView = useCallback(() => {
      applyFitView(true);
    }, [applyFitView]);

    const zoomIn = useCallback(() => {
      transformRef.current?.zoomIn(0.25, 200, "easeOut");
    }, []);

    const zoomOut = useCallback(() => {
      transformRef.current?.zoomOut(0.25, 200, "easeOut");
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focusOn,
        resetView,
        zoomIn,
        zoomOut,
        getZoom: () => transformRef.current?.state.scale ?? 1,
      }),
      [focusOn, resetView, zoomIn, zoomOut],
    );

    // Custom zoom: gentle mouse wheel + gentle pinch. Two-finger trackpad
    // scroll is left alone so the library can pan (Excalidraw-style).
    useEffect(() => {
      const el = wrapperRef.current;
      if (!el) return;

      const onWheel = (event: WheelEvent) => {
        const api = transformRef.current;
        if (!api) return;

        const isPinch = event.ctrlKey || event.metaKey;
        const mouseWheel = !isPinch && isLikelyMouseWheel(event);

        if (!isPinch && !mouseWheel) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        const rect = el.getBoundingClientRect();
        const cx = event.clientX - rect.left;
        const cy = event.clientY - rect.top;
        const { scale, positionX, positionY } = api.state;

        let nextScale: number;
        if (isPinch) {
          nextScale = clamp(
            scale * Math.exp(-event.deltaY * PINCH_SENSITIVITY),
            MIN_ZOOM,
            MAX_ZOOM,
          );
        } else {
          const zoomInDir = event.deltaY < 0;
          nextScale = clamp(
            scale * (zoomInDir ? MOUSE_WHEEL_FACTOR : 1 / MOUSE_WHEEL_FACTOR),
            MIN_ZOOM,
            MAX_ZOOM,
          );
        }

        if (Math.abs(nextScale - scale) < 0.0001) return;

        const worldX = (cx - positionX) / scale;
        const worldY = (cy - positionY) / scale;
        api.setTransform(
          cx - worldX * nextScale,
          cy - worldY * nextScale,
          nextScale,
          0,
        );
      };

      el.addEventListener("wheel", onWheel, { capture: true, passive: false });
      return () => {
        el.removeEventListener("wheel", onWheel, {
          capture: true,
        } as AddEventListenerOptions);
      };
    }, []);

    // Re-fit overview if the stage resizes while still on the initial view.
    useEffect(() => {
      const el = wrapperRef.current;
      if (!el || typeof ResizeObserver === "undefined") return;

      const observer = new ResizeObserver(() => {
        if (!didFitInit.current) {
          applyFitView(false);
          return;
        }
        // Only auto-adjust when the user is still at (near) overview.
        const api = transformRef.current;
        if (!api) return;
        const { width, height } = el.getBoundingClientRect();
        const fit = computeFitScale(width, height);
        if (Math.abs(api.state.scale - fit) < 0.04) {
          applyFitView(false);
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, [applyFitView]);

    return (
      <div
        ref={wrapperRef}
        className={`${styles.viewport} ${className ?? ""}`}
        data-ready={ready ? "true" : undefined}
      >
        <TransformWrapper
          ref={transformRef}
          initialScale={1}
          minScale={MIN_ZOOM}
          maxScale={MAX_ZOOM}
          centerOnInit={false}
          limitToBounds={false}
          // Library wheel zoom off — we handle mouse/pinch ourselves (above).
          // Two-finger trackpad still pans via trackPadPanning.
          wheel={{ disabled: true }}
          trackPadPanning={{ disabled: false, velocityDisabled: false }}
          pinch={{ disabled: true }}
          panning={{
            velocityDisabled: false,
            allowLeftClickPan: true,
            allowMiddleClickPan: true,
          }}
          doubleClick={{ mode: "zoomIn", step: 0.5, animationTime: 220 }}
          zoomAnimation={{ disabled: true }}
          velocityAnimation={{
            sensitivityMouse: 1,
            animationTime: 280,
          }}
          onInit={() => {
            applyFitView(false);
            didFitInit.current = true;
            setReady(true);
          }}
        >
          <TransformComponent
            wrapperClass={styles.transformWrapper}
            contentClass={styles.transformContent}
            wrapperStyle={{ width: "100%", height: "100%" }}
            contentStyle={{
              width: MAP_WORLD.width,
              height: MAP_WORLD.height,
            }}
          >
            {children}
          </TransformComponent>
        </TransformWrapper>
      </div>
    );
  },
);
