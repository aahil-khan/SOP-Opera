"use client";

import { useCallback, useEffect, useState } from "react";
import type { Handover } from "@/shared/schemas";
import { acceptHandover, acknowledgeHandoverItem } from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import { HandoverLedger } from "@/components/handover/HandoverLedger";
import styles from "./ShiftGate.module.css";

interface ShiftGateProps {
  onStartShift: (attentionAssetId: string | null) => void;
  onClose: () => void;
}

/**
 * Entry gate for the twin.
 *
 * The previous version was a preview whose "Start shift" button was enabled the
 * moment a fetch resolved — it gated on nothing. This one is the acknowledgement
 * step: the incoming operator clears each carried hazard here, and only then can
 * accept custody. Entering without accepting is still possible, and deliberately
 * labelled as such rather than dressed up as a skip.
 */
export function ShiftGate({ onStartShift, onClose }: ShiftGateProps) {
  const handover = useLiveStore((s) => s.handover);
  const loadHandover = useLiveStore((s) => s.loadHandover);
  const setHandover = useLiveStore((s) => s.setHandover);

  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadHandover();
  }, [loadHandover]);

  const run = useCallback(
    async (fn: () => Promise<Handover>, itemId?: string) => {
      setError(null);
      if (itemId) setBusyItemId(itemId);
      else setBusy(true);
      try {
        setHandover(await fn());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyItemId(null);
        setBusy(false);
      }
    },
    [setHandover],
  );

  const awaitingMe =
    handover?.state === "issued" && handover.viewer_role === "incoming";
  const outstanding = handover
    ? handover.required_total - handover.required_cleared
    : 0;

  const accept = useCallback(async () => {
    if (!handover) return;
    await run(() => acceptHandover(handover.id));
    onStartShift(handover.attention_asset_id);
  }, [handover, onStartShift, run]);

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Shift handover"
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <p className={styles.mark}>Shift start</p>
          <h2 className={styles.title}>
            {awaitingMe ? "Take custody of the plant" : "Handover status"}
          </h2>
          <p className={styles.subtitle}>
            {awaitingMe
              ? `${handover?.outgoing_actor_name} is holding ${outstanding} item${
                  outstanding === 1 ? "" : "s"
                } that need your acknowledgement before you take the shift.`
              : "No handover is waiting on you. You can enter the twin directly."}
          </p>
        </header>

        <div className={styles.body}>
          {error && <p className="text-error">{error}</p>}
          {handover && awaitingMe ? (
            <>
              {handover.brief && <p className={styles.brief}>{handover.brief}</p>}
              <HandoverLedger
                items={handover.items}
                canAcknowledge
                canEdit={false}
                compact
                busyItemId={busyItemId}
                onAcknowledge={(itemId, state, note) =>
                  run(
                    () =>
                      acknowledgeHandoverItem(handover.id, itemId, state, note),
                    itemId,
                  )
                }
                onSelectAsset={(assetId) => onStartShift(assetId)}
              />
            </>
          ) : (
            <p className={styles.idle}>
              {handover
                ? `The last handover from ${handover.outgoing_actor_name} to ${handover.incoming_actor_name} is ${handover.state}.`
                : "No handover has been recorded yet."}
            </p>
          )}
        </div>

        <footer className={styles.footer}>
          {awaitingMe && outstanding > 0 && (
            <p className={styles.blockedReason}>
              {outstanding} still to acknowledge
            </p>
          )}
          <button type="button" className={styles.skip} onClick={onClose}>
            {awaitingMe ? "Enter without accepting" : "Close"}
          </button>
          {awaitingMe ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void accept()}
              disabled={busy || outstanding > 0}
            >
              {busy ? "Accepting…" : "Accept shift"}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onStartShift(handover?.attention_asset_id ?? null)}
            >
              Start shift
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
