"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveAssetView } from "@/lib/liveStore";
import { spatialLinksFromAssessment } from "@/lib/liveStore";
import type { DomainId } from "@/lib/domains";
import { DOMAIN_META } from "@/lib/domains";
import type { ReferenceSource } from "@/shared/enums";
import type { AreaOwner, RetrievedReference } from "@/shared/schemas";
import { AssetTelemetry } from "./AssetTelemetry";
import { SpatialGraphPanel } from "./SpatialGraphPanel";
import styles from "./DomainDetailFlyout.module.css";

const REF_SECTIONS: {
  source: ReferenceSource;
  label: string;
  short: string;
}[] = [
  { source: "regulations", label: "Regulations", short: "Code & statute" },
  { source: "sops", label: "SOPs", short: "Plant procedure" },
  {
    source: "historical_incidents",
    label: "Past incidents",
    short: "Near-miss history",
  },
];

interface DomainDetailFlyoutProps {
  domain: DomainId | null;
  view: LiveAssetView;
  /** Fallback when review detail is not loaded (e.g. nominal assets). */
  areaOwner?: AreaOwner | null;
  onClose: () => void;
}

const EXIT_MS = 160;

function ctxSummary(c: {
  category: string;
  payload: Record<string, unknown>;
}): string {
  const p = c.payload;
  if (c.category === "sensor" && typeof p.gas_reading === "number") {
    return `Gas ${p.gas_reading}${typeof p.unit === "string" ? ` ${p.unit}` : ""}`;
  }
  if (c.category === "worker_location") {
    const name =
      typeof p.worker_name === "string"
        ? p.worker_name
        : `Worker ${String(p.worker_id ?? "?").slice(0, 8)}`;
    return `${name} in ${String(p.zone ?? "?")}`;
  }
  if (c.category === "permit") {
    const work =
      typeof p.work_type === "string"
        ? ` · ${p.work_type.replaceAll("_", " ")}`
        : "";
    return `Permit ${String(p.permit_id ?? "?")} · ${String(p.status ?? "")}${work}`;
  }
  return c.category;
}

function refLabel(r: {
  code?: string | null;
  title?: string | null;
  source: string;
}): string {
  if (r.code && r.title) return `${r.code}: ${r.title}`;
  if (r.title) return r.title;
  return r.source.replaceAll("_", " ");
}

function EvidenceRefItem({ reference: r }: { reference: RetrievedReference }) {
  return (
    <li className={styles.listItem} data-source={r.source}>
      <div className={styles.refMeta}>
        <span className={styles.pathBadge} data-path={r.retrieval_path}>
          {r.retrieval_path === "rag" ? "RAG" : "Rule"}
        </span>
        {r.triggered_by_fact && (
          <span className={styles.triggerBadge}>
            via {r.triggered_by_fact.replaceAll("_", " ")}
          </span>
        )}
      </div>
      <span className={styles.refTitle}>{refLabel(r)}</span>
      {r.snippet && <p className={styles.refSnippet}>{r.snippet}</p>}
    </li>
  );
}

function DomainBody({
  domain,
  view,
  areaOwner: areaOwnerProp,
}: {
  domain: DomainId;
  view: LiveAssetView;
  areaOwner?: AreaOwner | null;
}) {
  const context = view.detail?.context ?? [];
  const derivedFacts = view.detail?.derived_facts ?? [];
  const references = view.assessment?.retrieved_references ?? [];
  const areaOwner = view.detail?.area_owner ?? areaOwnerProp ?? null;
  const spatialLinks = spatialLinksFromAssessment(view.assessment);

  if (domain === "sensors") {
    return <AssetTelemetry assetId={view.asset.id} embedded />;
  }

  if (domain === "permits") {
    const permits = context.filter((c) => c.category === "permit");
    if (permits.length === 0) {
      return <p className={styles.muted}>No permit context for this asset.</p>;
    }
    return (
      <ul className={styles.list}>
        {permits.map((c) => (
          <li key={c.id} className={styles.listItem}>
            {ctxSummary(c)}
          </li>
        ))}
      </ul>
    );
  }

  if (domain === "people") {
    const workers = context.filter((c) => c.category === "worker_location");
    return (
      <>
        {areaOwner && (
          <p className={styles.ownerLine}>
            Area owner · <strong>{areaOwner.name}</strong> ({areaOwner.role})
          </p>
        )}
        {workers.length === 0 ? (
          <p className={styles.muted}>No workers detected in zone.</p>
        ) : (
          <ul className={styles.list}>
            {workers.map((c) => (
              <li key={c.id} className={styles.listItem}>
                {ctxSummary(c)}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  if (domain === "evidence") {
    if (derivedFacts.length === 0 && references.length === 0) {
      return <p className={styles.muted}>No evidence available yet.</p>;
    }

    const refsBySource = REF_SECTIONS.map((section) => ({
      ...section,
      items: references.filter((r) => r.source === section.source),
    })).filter((s) => s.items.length > 0);

    return (
      <div className={styles.evidenceStack}>
        {derivedFacts.length > 0 && (
          <section className={styles.evidenceSection} data-kind="facts">
            <header className={styles.evidenceHead}>
              <span className={styles.evidenceMark}>Facts</span>
              <span className={styles.evidenceLabel}>Derived signals</span>
              <span className={styles.evidenceCount}>{derivedFacts.length}</span>
            </header>
            <ul className={styles.factList}>
              {derivedFacts.map((f) => (
                <li key={f.id} className={styles.factItem}>
                  <span className={styles.factType}>
                    {String(f.fact_type).replaceAll("_", " ")}
                  </span>
                  <span className={styles.factValue}>
                    {typeof f.value === "boolean"
                      ? f.value
                        ? "Active"
                        : "Clear"
                      : String(f.value)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {refsBySource.map((section) => (
          <section
            key={section.source}
            className={styles.evidenceSection}
            data-kind={section.source}
          >
            <header className={styles.evidenceHead}>
              <span className={styles.evidenceMark}>{section.label}</span>
              <span className={styles.evidenceLabel}>{section.short}</span>
              <span className={styles.evidenceCount}>{section.items.length}</span>
            </header>
            <ul className={styles.list}>
              {section.items.map((r) => (
                <EvidenceRefItem key={`${r.source}-${r.id}`} reference={r} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <SpatialGraphPanel
      assetId={view.asset.id}
      assetName={view.asset.name}
      spatialLinks={spatialLinks}
      embedded
    />
  );
}

export function DomainDetailFlyout({
  domain,
  view,
  areaOwner = null,
  onClose,
}: DomainDetailFlyoutProps) {
  const [rendered, setRendered] = useState<DomainId | null>(domain);
  const [closing, setClosing] = useState(false);
  const [slideKey, setSlideKey] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const renderedRef = useRef<DomainId | null>(domain);

  useEffect(() => {
    renderedRef.current = rendered;
  }, [rendered]);

  useEffect(() => {
    if (exitTimer.current) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }

    if (domain === null) {
      if (renderedRef.current === null) return;
      setClosing(true);
      exitTimer.current = setTimeout(() => {
        setRendered(null);
        setClosing(false);
      }, EXIT_MS);
      return () => {
        if (exitTimer.current) clearTimeout(exitTimer.current);
      };
    }

    setClosing(false);
    if (renderedRef.current !== domain) {
      setRendered(domain);
      setSlideKey((k) => k + 1);
    }
  }, [domain]);

  // Bring into view when a domain is pinned / switched.
  useEffect(() => {
    if (!domain || closing) return;
    const el = rootRef.current;
    if (!el) return;
    const timer = window.setTimeout(() => {
      el.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [domain, slideKey, closing]);

  if (rendered === null) return null;

  const meta = DOMAIN_META[rendered];

  return (
    <div
      ref={rootRef}
      className={styles.flyout}
      data-domain={rendered}
      data-closing={closing ? "true" : undefined}
      role="dialog"
      aria-label={`${meta.label} detail`}
    >
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span
            className={styles.dot}
            style={{ background: `var(${meta.colorVar})` }}
          />
          <h4 className={styles.title}>{meta.label}</h4>
          <span className={styles.short}>{meta.short}</span>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close domain detail"
        >
          ×
        </button>
      </header>

      <div key={slideKey} className={styles.body}>
        <DomainBody domain={rendered} view={view} areaOwner={areaOwner} />
      </div>
    </div>
  );
}
