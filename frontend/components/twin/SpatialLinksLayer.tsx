"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
} from "react";
import type { SpatialLinkLine } from "@/lib/riskHeatmap";
import { linkEndpoints } from "@/lib/riskHeatmap";
import { useLiveStore } from "@/lib/liveStore";
import {
  otherAssetIdInLink,
  relationRelativeToFocus,
} from "@/lib/spatialRelation";
import type { PlantFloor } from "@/shared/enums";
import { MAP_WORLD } from "./MapViewport";
import floorPlanMap from "@/lib/floor_plan_map.json";
import styles from "./SpatialLinksLayer.module.css";

const MAP = floorPlanMap as Record<
  string,
  {
    x: number;
    y: number;
    floor?: PlantFloor;
    hit?: { x: number; y: number; w: number; h: number };
  }
>;

const WORLD_W = MAP_WORLD.width;
const WORLD_H = MAP_WORLD.height;
const PAD = 40;
const MAX_PULL = 72;
const ANCHOR_MAX_PULL = 36;
const SPRING = 0.12;
const DAMP = 0.82;
const IDLE_AMP = 3;
const MID_HIT_RADIUS = 48;
const ANCHOR_HIT_RADIUS = 28;
const EDGE_HIT_RADIUS = 18;
const CLICK_THRESH_SQ = 36;

type NodeRole = "from" | "mid" | "to";

type SimNode = {
  id: string;
  key: string;
  link: SpatialLinkLine;
  role: NodeRole;
  assetId: string;
  label: string;
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phaseX: number;
  phaseY: number;
  freqX: number;
  freqY: number;
};

interface SpatialLinksLayerProps {
  links: SpatialLinkLine[];
}

function clampWorld(n: SimNode) {
  n.x = Math.min(WORLD_W - PAD, Math.max(PAD, n.x));
  n.y = Math.min(WORLD_H - PAD, Math.max(PAD, n.y));
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pointInHitBox(
  px: number,
  py: number,
  hit: { x: number; y: number; w: number; h: number },
): boolean {
  return px >= hit.x && px <= hit.x + hit.w && py >= hit.y && py <= hit.y + hit.h;
}

function buildSimNodes(links: SpatialLinkLine[]): SimNode[] {
  const nodes: SimNode[] = [];
  let i = 0;
  for (const link of links) {
    const pts = linkEndpoints(link, MAP);
    if (!pts) continue;
    const key = `${link.from_asset_id}-${link.to_asset_id}-${link.relation}`;
    const dx = pts.x2 - pts.x1;
    const dy = pts.y2 - pts.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const sag = Math.min(40, len * 0.1);
    const mx = (pts.x1 + pts.x2) / 2;
    const my = (pts.y1 + pts.y2) / 2;
    const reviewAssetId = link.sourceAssetId ?? link.from_asset_id;
    const focusFloor = MAP[reviewAssetId]?.floor ?? "ground";
    const otherId = otherAssetIdInLink(reviewAssetId, link);
    const otherFloor = MAP[otherId]?.floor ?? "ground";
    const relation = relationRelativeToFocus(
      link.relation,
      focusFloor,
      otherFloor,
    );
    const midLabel = `${link.from_label} ↔ ${link.to_label}`;
    const midMeta = `${link.distance_m.toFixed(0)}m ${relation}`;

    const specs: Array<{
      role: NodeRole;
      assetId: string;
      label: string;
      homeX: number;
      homeY: number;
    }> = [
      {
        role: "from",
        assetId: link.from_asset_id,
        label: link.from_label,
        homeX: pts.x1,
        homeY: pts.y1,
      },
      {
        role: "mid",
        assetId: reviewAssetId,
        label: midLabel,
        homeX: mx + nx * sag,
        homeY: my + ny * sag,
      },
      {
        role: "to",
        assetId: link.to_asset_id,
        label: link.to_label,
        homeX: pts.x2,
        homeY: pts.y2,
      },
    ];

    for (const spec of specs) {
      nodes.push({
        key,
        link,
        id: `${key}:${spec.role}`,
        role: spec.role,
        assetId: spec.assetId,
        label: spec.role === "mid" ? `${spec.label} · ${midMeta}` : spec.label,
        homeX: spec.homeX,
        homeY: spec.homeY,
        x: spec.homeX,
        y: spec.homeY,
        vx: 0,
        vy: 0,
        phaseX: i * 1.7 + 0.4,
        phaseY: i * 2.3 + 0.7,
        freqX: 0.55 + (i % 4) * 0.12,
        freqY: 0.7 + (i % 3) * 0.15,
      });
      i += 1;
    }
  }
  return nodes;
}

function nearestTarget(
  x: number,
  y: number,
  sim: SimNode[],
): { nodeId: string; linkKey: string } | null {
  let bestId: string | null = null;
  let bestDist = MID_HIT_RADIUS;

  for (const n of sim) {
    if (n.role === "from" || n.role === "to") {
      const entry = MAP[n.assetId];
      if (entry?.hit && pointInHitBox(x, y, entry.hit)) {
        return { nodeId: n.id, linkKey: n.key };
      }
    }
    const radius = n.role === "mid" ? MID_HIT_RADIUS : ANCHOR_HIT_RADIUS;
    const d = Math.hypot(x - n.x, y - n.y);
    if (d < radius && d < bestDist) {
      bestDist = d;
      bestId = n.id;
    }
  }
  if (bestId) {
    const node = sim.find((n) => n.id === bestId);
    return node ? { nodeId: bestId, linkKey: node.key } : null;
  }

  const linkKeys = [...new Set(sim.map((n) => n.key))];
  for (const linkKey of linkKeys) {
    const from = sim.find((n) => n.id === `${linkKey}:from`);
    const mid = sim.find((n) => n.id === `${linkKey}:mid`);
    const to = sim.find((n) => n.id === `${linkKey}:to`);
    if (!from || !mid || !to) continue;
    const d1 = distToSegment(x, y, from.x, from.y, mid.x, mid.y);
    const d2 = distToSegment(x, y, mid.x, mid.y, to.x, to.y);
    const d = Math.min(d1, d2);
    if (d < EDGE_HIT_RADIUS) {
      return { nodeId: mid.id, linkKey };
    }
  }
  return null;
}

export const SpatialLinksLayer = memo(function SpatialLinksLayer({
  links,
}: SpatialLinksLayerProps) {
  const openAssetDomain = useLiveStore((s) => s.openAssetDomain);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<SimNode[]>([]);
  const bubbleEls = useRef(new Map<string, HTMLElement>());
  const edgeEls = useRef(new Map<string, SVGLineElement>());
  const dragRef = useRef<{
    nodeId: string;
    ox: number;
    oy: number;
    downX: number;
    downY: number;
    moved: boolean;
  } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const t0Ref = useRef(performance.now());
  const runningRef = useRef(false);
  const visibleRef = useRef(true);

  const applyFocusStyle = useCallback((linkKey: string | null) => {
    for (const [edgeId, line] of edgeEls.current) {
      if (linkKey && edgeId.startsWith(linkKey)) {
        line.setAttribute("data-focused", "true");
      } else {
        line.removeAttribute("data-focused");
      }
    }
    for (const n of simRef.current) {
      if (n.role !== "mid") continue;
      const el = bubbleEls.current.get(n.id);
      if (!el) continue;
      if (linkKey && n.key === linkKey) el.setAttribute("data-active", "true");
      else el.removeAttribute("data-active");
    }
  }, []);

  const structureKey = links
    .map(
      (l) =>
        `${l.from_asset_id}-${l.to_asset_id}-${l.relation}-${l.distance_m}`,
    )
    .join("|");

  const paint = useCallback(() => {
    const sim = simRef.current;
    for (const n of sim) {
      if (n.role !== "mid") continue;
      const el = bubbleEls.current.get(n.id);
      if (el) {
        el.style.left = `${n.x}px`;
        el.style.top = `${n.y}px`;
      }
    }

    const linkKeys = [...new Set(sim.map((n) => n.key))];
    for (const linkKey of linkKeys) {
      const from = sim.find((n) => n.id === `${linkKey}:from`);
      const mid = sim.find((n) => n.id === `${linkKey}:mid`);
      const to = sim.find((n) => n.id === `${linkKey}:to`);
      if (!from || !mid || !to) continue;

      const segments: Array<[SimNode, SimNode, string]> = [
        [from, mid, `${linkKey}:a`],
        [mid, to, `${linkKey}:b`],
      ];
      for (const [a, b, edgeId] of segments) {
        const line = edgeEls.current.get(edgeId);
        if (line) {
          line.setAttribute("x1", String(a.x));
          line.setAttribute("y1", String(a.y));
          line.setAttribute("x2", String(b.x));
          line.setAttribute("y2", String(b.y));
        }
      }
    }
  }, []);

  const setDraggingAttr = useCallback((nodeId: string | null) => {
    for (const [id, el] of bubbleEls.current) {
      if (nodeId && id === nodeId) el.setAttribute("data-dragging", "true");
      else el.removeAttribute("data-dragging");
    }
  }, []);

  useEffect(() => {
    const next = buildSimNodes(links);
    simRef.current = next.map((n) => {
      const prev = simRef.current.find((p) => p.id === n.id);
      return prev
        ? {
            ...n,
            homeX: n.homeX,
            homeY: n.homeY,
            x: prev.x,
            y: prev.y,
            vx: prev.vx,
            vy: prev.vy,
            phaseX: prev.phaseX,
            phaseY: prev.phaseY,
            freqX: prev.freqX,
            freqY: prev.freqY,
          }
        : n;
    });
    hoverRef.current = null;
    applyFocusStyle(null);
    requestAnimationFrame(() => paint());
  }, [structureKey, links, paint, applyFocusStyle]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || simRef.current.length === 0) return;

    const syncRunning = () => {
      const shouldRun =
        visibleRef.current && !document.hidden && simRef.current.length > 0;
      if (shouldRun === runningRef.current) return;
      runningRef.current = shouldRun;
      if (!shouldRun) {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        return;
      }
      const step = (now: number) => {
        if (!runningRef.current) return;
        const t = (now - t0Ref.current) / 1000;
        const dragging = dragRef.current?.nodeId ?? null;
        for (const n of simRef.current) {
          if (n.id === dragging) continue;

          const amp = n.role === "mid" ? IDLE_AMP : IDLE_AMP * 0.45;
          const targetX =
            n.homeX + Math.sin(t * n.freqX + n.phaseX) * amp;
          const targetY =
            n.homeY + Math.cos(t * n.freqY + n.phaseY) * amp;

          const ax = (targetX - n.x) * SPRING;
          const ay = (targetY - n.y) * SPRING;
          n.vx = (n.vx + ax) * DAMP;
          n.vy = (n.vy + ay) * DAMP;
          n.x += n.vx;
          n.y += n.vy;
          if (n.role === "mid") clampWorld(n);
        }
        paint();
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    };

    const onVisibility = () => syncRunning();
    document.addEventListener("visibilitychange", onVisibility);
    const io = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry?.isIntersecting ?? false;
        syncRunning();
      },
      { threshold: 0.05 },
    );
    io.observe(el);
    syncRunning();

    return () => {
      runningRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      io.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [paint, structureKey]);

  const clientToLocal = useCallback((clientX: number, clientY: number) => {
    const el = wrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const sx = WORLD_W / r.width;
    const sy = WORLD_H / r.height;
    return {
      x: (clientX - r.left) * sx,
      y: (clientY - r.top) * sy,
    };
  }, []);

  const activateNode = useCallback(
    (nodeId: string) => {
      const node = simRef.current.find((n) => n.id === nodeId);
      if (!node) return;
      openAssetDomain(node.assetId, "spatial");
    },
    [openAssetDomain],
  );

  const setBubbleRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) bubbleEls.current.set(id, el);
    else bubbleEls.current.delete(id);
  }, []);

  const setEdgeRef = useCallback((id: string, el: SVGLineElement | null) => {
    if (el) edgeEls.current.set(id, el);
    else edgeEls.current.delete(id);
  }, []);

  useEffect(() => {
    const host = wrapRef.current?.parentElement;
    if (!host || simRef.current.length === 0) return;

    const onDown = (e: PointerEvent) => {
      const p = clientToLocal(e.clientX, e.clientY);
      const hit = nearestTarget(p.x, p.y, simRef.current);
      if (!hit) return;
      const n = simRef.current.find((x) => x.id === hit.nodeId);
      if (!n) return;
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = {
        nodeId: hit.nodeId,
        ox: p.x - n.x,
        oy: p.y - n.y,
        downX: p.x,
        downY: p.y,
        moved: false,
      };
      n.vx = 0;
      n.vy = 0;
      hoverRef.current = n.key;
      applyFocusStyle(n.key);
      if (n.role === "mid") setDraggingAttr(hit.nodeId);
    };

    const onMove = (e: PointerEvent) => {
      const p = clientToLocal(e.clientX, e.clientY);
      const drag = dragRef.current;

      if (drag) {
        e.stopPropagation();
        e.preventDefault();
        host.style.cursor = "grabbing";
        const n = simRef.current.find((x) => x.id === drag.nodeId);
        if (!n) return;
        let x = p.x - drag.ox;
        let y = p.y - drag.oy;
        const maxPull = n.role === "mid" ? MAX_PULL : ANCHOR_MAX_PULL;
        const dx = x - n.homeX;
        const dy = y - n.homeY;
        const dist = Math.hypot(dx, dy);
        if (dist > maxPull) {
          const s = maxPull / dist;
          x = n.homeX + dx * s;
          y = n.homeY + dy * s;
        }
        n.x = x;
        n.y = y;
        if (n.role === "mid") clampWorld(n);
        if (
          !drag.moved &&
          (p.x - drag.downX) ** 2 + (p.y - drag.downY) ** 2 > CLICK_THRESH_SQ
        ) {
          drag.moved = true;
        }
        paint();
        return;
      }

      const hit = nearestTarget(p.x, p.y, simRef.current);
      const linkKey = hit?.linkKey ?? null;
      if (linkKey !== hoverRef.current) {
        hoverRef.current = linkKey;
        applyFocusStyle(linkKey);
      }
      host.style.cursor = hit ? "grab" : "";
    };

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.stopPropagation();
      if (!drag.moved) {
        activateNode(drag.nodeId);
      }
      dragRef.current = null;
      setDraggingAttr(null);
      host.style.cursor = "";
    };

    host.addEventListener("pointerdown", onDown, true);
    host.addEventListener("pointermove", onMove, true);
    host.addEventListener("pointerup", onUp, true);
    host.addEventListener("pointercancel", onUp, true);

    return () => {
      host.removeEventListener("pointerdown", onDown, true);
      host.removeEventListener("pointermove", onMove, true);
      host.removeEventListener("pointerup", onUp, true);
      host.removeEventListener("pointercancel", onUp, true);
    };
  }, [
    structureKey,
    clientToLocal,
    paint,
    activateNode,
    setDraggingAttr,
    applyFocusStyle,
  ]);

  const sim =
    simRef.current.length > 0 ? simRef.current : buildSimNodes(links);
  if (sim.length === 0) return null;

  const linkKeys = [...new Set(sim.map((n) => n.key))];
  const edgeIds: string[] = [];
  for (const linkKey of linkKeys) {
    edgeIds.push(`${linkKey}:a`, `${linkKey}:b`);
  }

  const midNodes = sim.filter((n) => n.role === "mid");

  return (
    <div ref={wrapRef} className={styles.canvas} aria-label="Spatial links">
      <svg
        className={styles.edgeSvg}
        viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {edgeIds.map((edgeId) => (
          <line
            key={edgeId}
            ref={(el) => setEdgeRef(edgeId, el)}
            className={styles.edge}
            x1={0}
            y1={0}
            x2={0}
            y2={0}
          />
        ))}
      </svg>

      {midNodes.map((n) => (
          <div
            key={n.id}
            ref={(el) => setBubbleRef(n.id, el)}
            className={styles.tag}
            style={
              {
                left: n.x,
                top: n.y,
                "--spatial-accent": "var(--domain-spatial)",
              } as CSSProperties
            }
          >
            <span className={styles.tagEyebrow}>Spatial link</span>
            <span className={styles.tagText}>{n.label}</span>
          </div>
        ))}
    </div>
  );
});
