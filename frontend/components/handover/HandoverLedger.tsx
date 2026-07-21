"use client";

import { useState } from "react";
import type { HandoverItem } from "@/shared/schemas";
import styles from "./Handover.module.css";

/**
 * The carry-forward ledger.
 *
 * Items are grouped by whether they must be acknowledged, because that is the
 * only distinction the incoming operator has to act on. Acknowledging one
 * collapses it to a signed line, so the list visibly drains as the shift starts.
 */

const TYPE_LABELS: Record<HandoverItem["item_type"], string> = {
  open_review: "Open review",
  active_fact: "Active fact",
  open_task: "Outstanding task",
  decision_condition: "Approval condition",
  note: "Operator note",
};

export interface HandoverLedgerProps {
  items: HandoverItem[];
  /** Only the incoming operator on an issued handover can acknowledge. */
  canAcknowledge: boolean;
  /** Only the outgoing operator on a draft can prune auto-composed items. */
  canEdit: boolean;
  compact?: boolean;
  onAcknowledge?: (
    itemId: string,
    state: "acknowledged" | "queried",
    note?: string,
  ) => void;
  onRemove?: (itemId: string) => void;
  onSelectAsset?: (assetId: string) => void;
  busyItemId?: string | null;
}

export function HandoverLedger({
  items,
  canAcknowledge,
  canEdit,
  compact = false,
  onAcknowledge,
  onRemove,
  onSelectAsset,
  busyItemId,
}: HandoverLedgerProps) {
  const required = items.filter((i) => i.requires_ack);
  const awareness = items.filter((i) => !i.requires_ack);

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyPulse} aria-hidden="true" />
        <p className={styles.emptyText}>
          Nothing is carried forward. No open reviews, active facts, outstanding
          tasks, or live approval conditions.
        </p>
      </div>
    );
  }

  return (
    <div className={compact ? styles.ledgerCompact : styles.ledger}>
      {required.length > 0 && (
        <section className={styles.group}>
          <h2 className={styles.groupLabel}>
            Must acknowledge
            <span className={styles.count}>{required.length}</span>
          </h2>
          <ul className={styles.itemList}>
            {required.map((item) => (
              <HandoverItemCard
                key={item.id}
                item={item}
                canAcknowledge={canAcknowledge}
                canEdit={canEdit}
                onAcknowledge={onAcknowledge}
                onRemove={onRemove}
                onSelectAsset={onSelectAsset}
                busy={busyItemId === item.id}
              />
            ))}
          </ul>
        </section>
      )}

      {awareness.length > 0 && (
        <section className={styles.group}>
          <h2 className={styles.groupLabel}>
            For awareness
            <span className={styles.count}>{awareness.length}</span>
          </h2>
          <ul className={styles.itemList}>
            {awareness.map((item) => (
              <HandoverItemCard
                key={item.id}
                item={item}
                canAcknowledge={false}
                canEdit={canEdit}
                onRemove={onRemove}
                onSelectAsset={onSelectAsset}
                busy={busyItemId === item.id}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface HandoverItemCardProps {
  item: HandoverItem;
  canAcknowledge: boolean;
  canEdit: boolean;
  onAcknowledge?: (
    itemId: string,
    state: "acknowledged" | "queried",
    note?: string,
  ) => void;
  onRemove?: (itemId: string) => void;
  onSelectAsset?: (assetId: string) => void;
  busy: boolean;
}

function HandoverItemCard({
  item,
  canAcknowledge,
  canEdit,
  onAcknowledge,
  onRemove,
  onSelectAsset,
  busy,
}: HandoverItemCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cleared = item.ack_state !== "pending";

  return (
    <li
      className={styles.item}
      data-risk={item.risk_level}
      data-type={item.item_type}
      data-cleared={cleared}
    >
      <div className={styles.itemHead}>
        <div className={styles.itemHeadMain}>
          <span className={styles.itemType}>{TYPE_LABELS[item.item_type]}</span>
          <h3 className={styles.itemTitle}>{item.title}</h3>
        </div>
        <span className="badge" data-risk={item.risk_level}>
          {item.risk_level}
        </span>
      </div>

      {item.detail && <p className={styles.itemDetail}>{item.detail}</p>}

      {item.hazard_dimensions.length > 0 && (
        <ul className={styles.dims}>
          {item.hazard_dimensions.map((d) => (
            <li key={d} className={styles.dim}>
              {d.replaceAll("_", " ")}
            </li>
          ))}
        </ul>
      )}

      {cleared ? (
        <p className={styles.signedLine}>
          {item.ack_state === "queried" ? "Queried" : "Acknowledged"} by{" "}
          {item.acknowledged_by_name ?? "operator"}
          {item.ack_note ? ` — “${item.ack_note}”` : ""}
        </p>
      ) : null}

      <div className={styles.itemActions}>
        {item.asset_id && onSelectAsset && (
          <button
            type="button"
            className={styles.linkAction}
            onClick={() => onSelectAsset(item.asset_id as string)}
          >
            Show on twin
          </button>
        )}
        {canEdit && onRemove && (
          <button
            type="button"
            className={styles.linkAction}
            onClick={() => onRemove(item.id)}
            disabled={busy}
          >
            Not relevant
          </button>
        )}
        {canAcknowledge && !cleared && onAcknowledge && (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setExpanded((v) => !v)}
              disabled={busy}
            >
              Query
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onAcknowledge(item.id, "acknowledged")}
              disabled={busy}
            >
              {busy ? "Recording…" : "Acknowledge"}
            </button>
          </>
        )}
      </div>

      {/* 0fr → 1fr, so the query box animates open without measuring height. */}
      <div className={styles.reveal} data-open={expanded}>
        <div className={styles.revealInner}>
          <QueryBox
            inputId={`handover-query-${item.id}`}
            onSubmit={(note) => {
              onAcknowledge?.(item.id, "queried", note || undefined);
              setExpanded(false);
            }}
            onCancel={() => setExpanded(false)}
          />
        </div>
      </div>
    </li>
  );
}

function QueryBox({
  inputId,
  onSubmit,
  onCancel,
}: {
  inputId: string;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className={styles.queryBox}>
      <label className={styles.queryLabel} htmlFor={inputId}>
        What do you need from the outgoing operator?
      </label>
      <textarea
        id={inputId}
        className={styles.queryInput}
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Was the isolation actually verified before you left?"
      />
      <div className={styles.queryActions}>
        <button type="button" className={styles.linkAction} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onSubmit(note.trim())}
        >
          Raise query
        </button>
      </div>
    </div>
  );
}
