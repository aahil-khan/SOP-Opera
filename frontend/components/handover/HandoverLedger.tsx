"use client";

import { useState, type ReactNode } from "react";
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
  response_action: "Automatic response",
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

/** Worst-first, matching the ranking `handover/composer.py` already sorts items by. */
const _RISK_ORDER: Record<string, number> = { blocking: 0, critical: 0, elevated: 1, nominal: 2 };

/**
 * Groups items by asset, preserving each group's internal order (already
 * risk/type-ranked by the backend). Multiple items about the same asset —
 * routine when a busy asset spawns several tasks in one shift — cluster
 * under one heading instead of repeating the asset name in every card title
 * with nothing visually tying them together.
 *
 * Each group also carries its worst contained risk level, so the cluster's
 * rail can read as severe even if a lower-risk item happens to sort first —
 * a busy asset with one blocking and one nominal item is still a busy asset.
 */
function groupByAsset(
  items: HandoverItem[],
): { assetName: string; items: HandoverItem[]; worstRisk: string }[] {
  const groups: { assetName: string; items: HandoverItem[]; worstRisk: string }[] = [];
  const index = new Map<string, number>();
  for (const item of items) {
    const key = item.asset_name ?? "Plant-wide";
    let i = index.get(key);
    if (i === undefined) {
      i = groups.length;
      index.set(key, i);
      groups.push({ assetName: key, items: [], worstRisk: "nominal" });
    }
    const g = groups[i];
    g.items.push(item);
    if (
      (_RISK_ORDER[item.risk_level] ?? 3) < (_RISK_ORDER[g.worstRisk] ?? 3)
    ) {
      g.worstRisk = item.risk_level;
    }
  }
  return groups;
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
  const requiredGroups = groupByAsset(required);
  const awarenessGroups = groupByAsset(awareness);

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
          {requiredGroups.map((g) => (
            <AssetGroup
              key={g.assetName}
              assetName={g.assetName}
              count={g.items.length}
              worstRisk={g.worstRisk}
              multi={requiredGroups.length > 1}
            >
              <ul className={styles.itemList}>
                {g.items.map((item) => (
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
            </AssetGroup>
          ))}
        </section>
      )}

      {awareness.length > 0 && (
        <section className={styles.group}>
          <h2 className={styles.groupLabel}>
            For awareness
            <span className={styles.count}>{awareness.length}</span>
          </h2>
          {awarenessGroups.map((g) => (
            <AssetGroup
              key={g.assetName}
              assetName={g.assetName}
              count={g.items.length}
              worstRisk={g.worstRisk}
              multi={awarenessGroups.length > 1}
            >
              <ul className={styles.itemList}>
                {g.items.map((item) => (
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
            </AssetGroup>
          ))}
        </section>
      )}
    </div>
  );
}

/**
 * A per-asset cluster within a section. Only shows its own heading when
 * there's more than one asset in the section — a single-asset section
 * (the common case for a quiet shift) would otherwise repeat the same
 * name twice for no reason.
 *
 * The rail tints to the cluster's worst contained risk, and a count badge
 * appears once an asset actually has more than one carried-forward item —
 * that's the compound-risk case worth flagging, not a redundant "1 item".
 */
function AssetGroup({
  assetName,
  count,
  worstRisk,
  multi,
  children,
}: {
  assetName: string;
  count: number;
  worstRisk: string;
  multi: boolean;
  children: ReactNode;
}) {
  if (!multi) return <>{children}</>;
  return (
    <div className={styles.assetGroup} data-risk={worstRisk}>
      <h3 className={styles.assetGroupLabel}>
        {assetName}
        {count > 1 && (
          <span className={styles.assetGroupCount}>
            {count} item{count === 1 ? "" : "s"}
          </span>
        )}
      </h3>
      {children}
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
