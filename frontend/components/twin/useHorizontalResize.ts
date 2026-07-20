"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type HorizontalResizeEdge = "e" | "w";

interface UseHorizontalResizeArgs {
  width: number;
  onWidthChange: (width: number) => void;
  minWidth: number;
  maxWidth: number;
  /** Which edge of the panel is being dragged. */
  edge: HorizontalResizeEdge;
  disabled?: boolean;
}

/**
 * Docked horizontal-only resize. Widening gives content more room; height
 * and vertical stacking stay fixed by the panel's existing layout.
 */
export function useHorizontalResize({
  width,
  onWidthChange,
  minWidth,
  maxWidth,
  edge,
  disabled = false,
}: UseHorizontalResizeArgs) {
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    pointerId: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startWidth: width,
        pointerId: e.pointerId,
      };
      setResizing(true);
    },
    [disabled, width],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (disabled) return;
      const step = e.shiftKey ? 24 : 12;
      let next = width;
      if (e.key === "ArrowRight") {
        next = edge === "e" ? width + step : width - step;
      } else if (e.key === "ArrowLeft") {
        next = edge === "e" ? width - step : width + step;
      } else if (e.key === "Home") {
        next = minWidth;
      } else if (e.key === "End") {
        next = maxWidth;
      } else {
        return;
      }
      e.preventDefault();
      onWidthChange(Math.min(maxWidth, Math.max(minWidth, Math.round(next))));
    },
    [disabled, edge, maxWidth, minWidth, onWidthChange, width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startX;
      const next =
        edge === "e" ? drag.startWidth + dx : drag.startWidth - dx;
      const clamped = Math.min(maxWidth, Math.max(minWidth, next));
      onWidthChange(Math.round(clamped));
    },
    [edge, maxWidth, minWidth, onWidthChange],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    setResizing(false);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const prev = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prev;
      document.body.style.userSelect = prevSelect;
    };
  }, [resizing]);

  return {
    resizing,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
    },
  };
}
