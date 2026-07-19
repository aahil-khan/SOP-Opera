"use client";

import { useCallback, useRef, useState } from "react";

export interface FloatPos {
  x: number;
  y: number;
}

export interface FloatSize {
  w: number;
  h: number;
}

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface UseFloatingPanelArgs {
  minW: number;
  minH: number;
  disabled?: boolean;
}

/**
 * Drag-to-float + all-edge resize for a panel that otherwise renders at a
 * fixed "docked" position via CSS. While pos/size are null the panel stays
 * docked; grabbing the header or a resize handle lifts it into free-floating
 * absolute coordinates (clamped to its offsetParent) until snapToDefault()
 * clears them again.
 */
export function useFloatingPanel({ minW, minH, disabled = false }: UseFloatingPanelArgs) {
  const [pos, setPos] = useState<FloatPos | null>(null);
  const [size, setSize] = useState<FloatSize | null>(null);
  const [interacting, setInteracting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // Distinct from `size != null`: a plain drag also freezes `size` (to stop
  // the panel auto-sizing to its content once un-docked), but that shouldn't
  // read as "the user resized/maximized this panel" for icon/style purposes.
  const [isResized, setIsResized] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startMouse: FloatPos; startPos: FloatPos } | null>(null);
  const resizeRef = useRef<{
    startMouse: FloatPos;
    startSize: FloatSize;
    startPos: FloatPos;
    edge: ResizeEdge;
  } | null>(null);

  const floating = pos != null || size != null;

  const stageSize = useCallback((): { w: number; h: number } => {
    const parent = panelRef.current?.offsetParent as HTMLElement | null;
    return parent
      ? { w: parent.offsetWidth, h: parent.offsetHeight }
      : { w: window.innerWidth, h: window.innerHeight };
  }, []);

  const anchorTopLeft = useCallback((): FloatPos => {
    const panel = panelRef.current!;
    const p = { x: panel.offsetLeft, y: panel.offsetTop };
    setPos(p);
    return p;
  }, []);

  const snapToDefault = useCallback(() => {
    setPos(null);
    setSize(null);
    setIsResized(false);
  }, []);

  const maximize = useCallback(() => {
    const pad = 16;
    const { w: sw, h: sh } = stageSize();
    if (size && size.w > sw * 0.7 && size.h > sh * 0.7) {
      snapToDefault();
    } else {
      setPos({ x: pad, y: pad });
      setSize({ w: sw - pad * 2, h: sh - pad * 2 });
      setIsResized(true);
    }
  }, [size, stageSize, snapToDefault]);

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      if ((e.target as HTMLElement).closest("button,select,input,textarea")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const panel = panelRef.current;
      if (!panel) return;
      setInteracting(true);
      setIsDragging(true);
      // Freeze the panel's current on-screen rect into explicit pos/size
      // *before* it goes floating — otherwise losing the docked width/height
      // lets content (e.g. an unwrapped multi-column board) auto-size the
      // panel much wider/taller than it looked a moment ago.
      const startPos = pos ?? { x: panel.offsetLeft, y: panel.offsetTop };
      const startSize = size ?? { w: panel.offsetWidth, h: panel.offsetHeight };
      setPos(startPos);
      setSize(startSize);
      dragRef.current = {
        startMouse: { x: e.clientX, y: e.clientY },
        startPos,
      };
    },
    [pos, size, disabled],
  );

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent, edge: ResizeEdge) => {
      if (disabled) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const panel = panelRef.current!;
      const startPos = pos ?? anchorTopLeft();
      setInteracting(true);
      setIsResized(true);
      resizeRef.current = {
        startMouse: { x: e.clientX, y: e.clientY },
        startSize: size ?? { w: panel.offsetWidth, h: panel.offsetHeight },
        startPos,
        edge,
      };
    },
    [pos, size, disabled, anchorTopLeft],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (resizeRef.current) {
        const { startMouse, startSize, startPos, edge } = resizeRef.current;
        const dx = e.clientX - startMouse.x;
        const dy = e.clientY - startMouse.y;
        const { w: sw, h: sh } = stageSize();

        let newW = startSize.w;
        let newH = startSize.h;
        let newX = startPos.x;
        let newY = startPos.y;

        if (edge.includes("e")) {
          newW = Math.max(minW, Math.min(startSize.w + dx, sw - startPos.x - 4));
        }
        if (edge.includes("s")) {
          newH = Math.max(minH, Math.min(startSize.h + dy, sh - startPos.y - 4));
        }
        if (edge.includes("w")) {
          const capped = Math.min(dx, startSize.w - minW);
          newX = Math.max(0, startPos.x + capped);
          newW = startSize.w - (newX - startPos.x);
        }
        if (edge.includes("n")) {
          const capped = Math.min(dy, startSize.h - minH);
          newY = Math.max(0, startPos.y + capped);
          newH = startSize.h - (newY - startPos.y);
        }

        setSize({ w: newW, h: newH });
        if (newX !== startPos.x || newY !== startPos.y) setPos({ x: newX, y: newY });
        return;
      }
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startMouse.x;
        const dy = e.clientY - dragRef.current.startMouse.y;
        const panel = panelRef.current;
        if (!panel) return;
        const { w: sw, h: sh } = stageSize();
        const pw = size?.w ?? panel.offsetWidth;
        const ph = size?.h ?? panel.offsetHeight;
        setPos({
          x: Math.max(0, Math.min(dragRef.current.startPos.x + dx, sw - pw)),
          y: Math.max(0, Math.min(dragRef.current.startPos.y + dy, sh - ph)),
        });
      }
    },
    [size, minW, minH, stageSize],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    resizeRef.current = null;
    setInteracting(false);
    setIsDragging(false);
  }, []);

  const style: React.CSSProperties = {
    ...(pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : {}),
    ...(size ? { width: size.w, height: size.h } : {}),
  };

  return {
    panelRef,
    floating,
    interacting,
    isDragging,
    isResized,
    pos,
    size,
    style,
    onHeaderPointerDown,
    onResizePointerDown,
    onPointerMove,
    onPointerUp,
    snapToDefault,
    maximize,
    stageSize,
    setPos,
    setSize,
  };
}
