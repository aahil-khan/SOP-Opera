"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { DOMAIN_META, type DomainId } from "@/lib/domains";
import {
  BAND_LABEL,
  type PipelineBand,
  type ReasoningGraphData,
  type ReasoningGraphNode,
} from "@/lib/reasoningGraph";
import styles from "./ReasoningGraph.module.css";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

interface FgNode extends ReasoningGraphNode {
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
  color: string;
  rowIndex: number;
}

interface ReasoningGraphProps {
  data: ReasoningGraphData;
  selectedId: string | null;
  onSelect: (node: ReasoningGraphNode | null) => void;
  /** Shorter height for in-drawer / twin embedding. */
  compact?: boolean;
}

const ROW_HEIGHT = 96;
const COL_GAP = 108;
const TOP_PAD = 50;

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

function colorForDomain(domain: DomainId | "core"): string {
  if (domain === "core") {
    return readCssVar("--accent-ai", "#9b7bb8");
  }
  return readCssVar(DOMAIN_META[domain].colorVar, "#6b8fc4");
}

interface BandRange {
  band: PipelineBand;
  fromRow: number;
  toRow: number;
}

/** Rigid top-to-bottom layered layout: one row per stage, nodes pinned. */
function layoutNodes(nodes: ReasoningGraphNode[]): {
  fgNodes: FgNode[];
  bandRanges: BandRange[];
  rowCount: number;
} {
  const stages = Array.from(new Set(nodes.map((n) => n.stage))).sort(
    (a, b) => a - b,
  );
  const rowOfStage = new Map<number, number>();
  stages.forEach((s, i) => rowOfStage.set(s, i));

  const byRow = new Map<number, ReasoningGraphNode[]>();
  for (const n of nodes) {
    const row = rowOfStage.get(n.stage) ?? 0;
    const arr = byRow.get(row) ?? [];
    arr.push(n);
    byRow.set(row, arr);
  }

  const fgNodes: FgNode[] = [];
  for (const [row, rowNodes] of byRow) {
    const y = TOP_PAD + row * ROW_HEIGHT;
    const n = rowNodes.length;
    rowNodes.forEach((node, i) => {
      const x = (i - (n - 1) / 2) * COL_GAP;
      fgNodes.push({
        ...node,
        rowIndex: row,
        x,
        y,
        fx: x,
        fy: y,
        color: colorForDomain(node.domain),
      });
    });
  }

  // Band ranges for background bands / labels — contiguous rows sharing a band.
  const bandRanges: BandRange[] = [];
  let current: BandRange | null = null;
  for (const stage of stages) {
    const row = rowOfStage.get(stage) as number;
    const rowNodes = byRow.get(row) ?? [];
    const band = rowNodes[0]?.band ?? "trigger";
    if (current && current.band === band) {
      current.toRow = row;
    } else {
      if (current) bandRanges.push(current);
      current = { band, fromRow: row, toRow: row };
    }
  }
  if (current) bandRanges.push(current);

  return { fgNodes, bandRanges, rowCount: stages.length };
}

export function ReasoningGraph({
  data,
  selectedId,
  onSelect,
  compact = false,
}: ReasoningGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(undefined);
  const [dimensions, setDimensions] = useState({ width: 640, height: 480 });
  const [themeTick, setThemeTick] = useState(0);
  const hasFitRef = useRef(false);

  useEffect(() => {
    setThemeTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const minH = compact ? 200 : 340;
    const update = () => {
      const r = el.getBoundingClientRect();
      setDimensions({
        width: Math.max(compact ? 240 : 320, Math.floor(r.width)),
        height: Math.max(minH, Math.floor(r.height)),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact]);

  const { fgNodes, bandRanges } = useMemo(() => {
    void themeTick;
    return layoutNodes(data.nodes);
  }, [data.nodes, themeTick]);

  const graphData = useMemo(() => {
    const links = data.edges.map((e) => ({
      source: e.source,
      target: e.target,
      relation: e.relation,
    }));
    return { nodes: fgNodes, links };
  }, [fgNodes, data.edges]);

  useEffect(() => {
    hasFitRef.current = false;
  }, [data]);

  const nodeVal = (node: FgNode) =>
    Math.max(6, Math.min((node.weight ?? 6) * 0.8, 15));

  const handleZoomIn = () => {
    if (!graphRef.current) return;
    graphRef.current.zoom(graphRef.current.zoom() * 1.4, 280);
  };
  const handleZoomOut = () => {
    if (!graphRef.current) return;
    graphRef.current.zoom(graphRef.current.zoom() / 1.4, 280);
  };
  const handleFit = () => {
    graphRef.current?.zoomToFit(400, 48);
  };

  if (data.nodes.length === 0) {
    return (
      <div className={styles.empty} ref={containerRef}>
        <p>No reasoning graph data yet.</p>
      </div>
    );
  }

  return (
    <div
      className={styles.root}
      data-compact={compact ? "true" : undefined}
      ref={containerRef}
    >
      <div className={styles.controls}>
        <button type="button" className={styles.ctrlBtn} onClick={handleZoomIn}>
          +
        </button>
        <button type="button" className={styles.ctrlBtn} onClick={handleZoomOut}>
          −
        </button>
        <button type="button" className={styles.ctrlBtn} onClick={handleFit}>
          Fit
        </button>
      </div>
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="rgba(0,0,0,0)"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        nodeColor={(node: any) => node.color}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        nodeVal={(node: any) => nodeVal(node as FgNode)}
        nodeRelSize={6}
        onRenderFramePre={(ctx: CanvasRenderingContext2D) => {
          const mutedText = readCssVar("--text-muted", "#6b7380");
          const bandLine = readCssVar("--border-muted", "#22262d");
          ctx.save();
          // Vertical spine reinforcing the top-to-bottom read order.
          if (fgNodes.length > 0) {
            const minY = TOP_PAD;
            const maxY =
              TOP_PAD +
              Math.max(...fgNodes.map((n) => n.rowIndex)) * ROW_HEIGHT;
            ctx.strokeStyle = bandLine;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(0, minY - 20);
            ctx.lineTo(0, maxY + 20);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          // Band separators + centered labels — kept near x=0 so they stay
          // inside the node bounding box used by zoomToFit.
          const xs = fgNodes.map((n) => n.x ?? 0);
          const spanX = xs.length
            ? Math.max(240, Math.max(...xs) - Math.min(...xs) + 120)
            : 240;
          for (const b of bandRanges.slice(1)) {
            const yTop = TOP_PAD + b.fromRow * ROW_HEIGHT - ROW_HEIGHT / 2 + 12;
            ctx.strokeStyle = bandLine;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(-spanX / 2, yTop);
            ctx.lineTo(spanX / 2, yTop);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          for (const b of bandRanges) {
            const yTop = TOP_PAD + b.fromRow * ROW_HEIGHT - ROW_HEIGHT / 2 + 12;
            ctx.fillStyle = mutedText;
            ctx.font = "700 11px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(BAND_LABEL[b.band].toUpperCase(), 0, yTop + 13);
          }
          ctx.restore();
        }}
        nodeCanvasObject={(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          node: any,
          ctx: CanvasRenderingContext2D,
          globalScale: number,
        ) => {
          const n = node as FgNode;
          const size = nodeVal(n);
          const isSelected = n.id === selectedId;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, size, 0, 2 * Math.PI, false);
          ctx.fillStyle = n.color;
          ctx.fill();
          ctx.strokeStyle = isSelected
            ? readCssVar("--accent-selection", "#5a8fd4")
            : readCssVar("--surface-overlay", "#1c2128");
          ctx.lineWidth = isSelected ? 3 : 1.5;
          ctx.stroke();

          if (isSelected) {
            ctx.beginPath();
            ctx.arc(n.x ?? 0, n.y ?? 0, size * 1.35, 0, 2 * Math.PI, false);
            ctx.strokeStyle = readCssVar("--accent-selection", "#5a8fd4");
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          const fontSize = Math.max(11, 12 / Math.sqrt(globalScale));
          const label =
            n.label.length > 26 ? `${n.label.slice(0, 24)}…` : n.label;
          ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
          const tw = ctx.measureText(label).width;
          const pad = 4;
          const lx = n.x ?? 0;
          const ly = (n.y ?? 0) + size + 10;
          ctx.fillStyle = "rgba(12, 14, 17, 0.82)";
          if (typeof ctx.roundRect === "function") {
            ctx.beginPath();
            ctx.roundRect(
              lx - tw / 2 - pad,
              ly - fontSize / 2 - pad * 0.6,
              tw + pad * 2,
              fontSize + pad * 1.2,
              3,
            );
            ctx.fill();
          } else {
            ctx.fillRect(
              lx - tw / 2 - pad,
              ly - fontSize / 2 - pad * 0.6,
              tw + pad * 2,
              fontSize + pad * 1.2,
            );
          }
          ctx.fillStyle = "#e6e8eb";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(label, lx, ly);
        }}
        nodeCanvasObjectMode={() => "replace"}
        linkWidth={1.4}
        linkColor={() => readCssVar("--border-hover", "#3a424d")}
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={1}
        linkCurvature={0}
        linkDirectionalParticles={0}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onNodeClick={(node: any) => {
          const n = node as FgNode;
          onSelect(n.id === selectedId ? null : n);
        }}
        onBackgroundClick={() => onSelect(null)}
        cooldownTicks={0}
        enableNodeDrag
        enableZoomInteraction
        enablePanInteraction
        onEngineStop={() => {
          if (graphRef.current && !hasFitRef.current) {
            hasFitRef.current = true;
            graphRef.current.zoomToFit(400, 56);
          }
        }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onNodeDragEnd={(node: any) => {
          node.fx = node.x;
          node.fy = node.y;
        }}
      />
    </div>
  );
}
