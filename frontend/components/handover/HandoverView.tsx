"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Handover } from "@/shared/schemas";
import type { RosterEntry } from "@/lib/authTypes";
import { fetchRoster } from "@/lib/authApi";
import { getActorFromCookie } from "@/lib/actorCookie";
import {
  acceptHandover,
  acknowledgeHandoverItem,
  addHandoverNote,
  draftHandover,
  issueHandover,
  removeHandoverItem,
} from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import { HandoverLedger } from "./HandoverLedger";
import styles from "./Handover.module.css";

/**
 * Shift handover — the page.
 *
 * Which side you see is decided by the server (`viewer_role`), not by a tab:
 * the outgoing operator composes and issues, the incoming operator acknowledges
 * and accepts, and anyone else (the supervisor) reads. Custody has two ends and
 * you are only ever standing at one of them.
 */
export function HandoverView() {
  const router = useRouter();
  const handover = useLiveStore((s) => s.handover);
  const handoverLoading = useLiveStore((s) => s.handoverLoading);
  const loadHandover = useLiveStore((s) => s.loadHandover);
  const setHandover = useLiveStore((s) => s.setHandover);
  const selectAsset = useLiveStore((s) => s.selectAsset);

  const [actor, setActor] = useState<ReturnType<typeof getActorFromCookie>>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setActor(getActorFromCookie());
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

  const showOnTwin = useCallback(
    (assetId: string) => {
      selectAsset(assetId);
      router.push("/operator");
    },
    [router, selectAsset],
  );

  const role = handover?.viewer_role ?? "observer";
  const settled =
    handover?.state === "accepted" || handover?.state === "expired";

  // A settled handover is history — the next shift change starts a fresh one.
  if (!handover || settled) {
    return (
      <div className={styles.page}>
        <PageHeader />
        {error && <p className="text-error">{error}</p>}
        {handover && settled && <SettledSummary handover={handover} />}
        <StartHandover
          actorId={actor?.id ?? null}
          busy={busy}
          onStart={(incomingId, hours) =>
            run(() => draftHandover(incomingId, hours))
          }
        />
        {handoverLoading && <p className={styles.loadingLine}>Loading…</p>}
      </div>
    );
  }

  const canEdit = handover.state === "draft" && role === "outgoing";
  const canAcknowledge = handover.state === "issued" && role === "incoming";
  const outstanding = handover.required_total - handover.required_cleared;

  return (
    <div className={styles.page} data-tour="handover">
      <PageHeader />
      {error && <p className="text-error">{error}</p>}

      <div className={styles.columns}>
        <main className={styles.ledgerColumn}>
          {handover.brief && (
            <section className={styles.brief}>
              <header className={styles.briefHeader}>
                <span className="section-label">Shift narration</span>
                <span className={styles.modeChip}>
                  {handover.narration_mode === "llm"
                    ? "model narration"
                    : "deterministic narration · no LLM configured"}
                </span>
              </header>
              <p className={styles.briefText}>{handover.brief}</p>
            </section>
          )}

          <HandoverLedger
            items={handover.items}
            canAcknowledge={canAcknowledge}
            canEdit={canEdit}
            busyItemId={busyItemId}
            onSelectAsset={showOnTwin}
            onAcknowledge={(itemId, state, note) =>
              run(
                () =>
                  acknowledgeHandoverItem(handover.id, itemId, state, note),
                itemId,
              )
            }
            onRemove={(itemId) =>
              run(() => removeHandoverItem(handover.id, itemId), itemId)
            }
          />

          {canEdit && (
            <AddNote
              busy={busy}
              onAdd={(title, detail, requiresAck) =>
                run(() =>
                  addHandoverNote(handover.id, {
                    title,
                    detail,
                    requires_ack: requiresAck,
                  }),
                )
              }
            />
          )}
        </main>

        <aside className={styles.rail}>
          <PartyStrip handover={handover} role={role} />

          <div className={styles.progress}>
            <span className="section-label">Acknowledgement</span>
            <p className={styles.progressCount}>
              {handover.required_cleared} of {handover.required_total} cleared
            </p>
            <ProgressPips
              total={handover.required_total}
              cleared={handover.required_cleared}
            />
          </div>

          {canEdit && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => run(() => issueHandover(handover.id))}
              disabled={busy}
            >
              {busy
                ? "Issuing…"
                : `Issue to ${handover.incoming_actor_name}`}
            </button>
          )}

          {canAcknowledge && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => run(() => acceptHandover(handover.id))}
                disabled={busy || outstanding > 0}
              >
                {busy ? "Accepting…" : "Accept shift"}
              </button>
              {/* State the blocker rather than leaving a dead button. */}
              {outstanding > 0 && (
                <p className={styles.blockedReason}>
                  {outstanding} item{outstanding === 1 ? "" : "s"} still need
                  acknowledgement before you can take custody.
                </p>
              )}
            </>
          )}

          {role === "observer" && (
            <p className={styles.observerNote}>
              You are reading this handover, not party to it. Only{" "}
              {handover.state === "draft"
                ? handover.outgoing_actor_name
                : handover.incoming_actor_name}{" "}
              can act on it.
            </p>
          )}

          {handover.state === "issued" && role === "outgoing" && (
            <p className={styles.observerNote}>
              Issued to {handover.incoming_actor_name}. Waiting for them to
              acknowledge and take custody.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <header className={styles.header}>
      <p className="section-label">Shift custody</p>
      <h1 className={styles.title}>Handover</h1>
      <p className={styles.meta}>
        Everything the outgoing operator is still holding, transferred to a named
        incoming operator who has to acknowledge each hazard before taking the
        plant. Every step is recorded in the audit chain.
      </p>
    </header>
  );
}

function PartyStrip({
  handover,
  role,
}: {
  handover: Handover;
  role: string;
}) {
  return (
    <div className={styles.parties}>
      <div className={styles.party} data-you={role === "outgoing"}>
        <span className={styles.partyRole}>Outgoing</span>
        <span className={styles.partyName}>{handover.outgoing_actor_name}</span>
      </div>
      <span className={styles.partyArrow} aria-hidden="true">
        →
      </span>
      <div className={styles.party} data-you={role === "incoming"}>
        <span className={styles.partyRole}>Incoming</span>
        <span className={styles.partyName}>{handover.incoming_actor_name}</span>
      </div>
      <span className="badge" data-risk={badgeRiskForState(handover.state)}>
        {handover.state}
      </span>
    </div>
  );
}

/** Map handover state onto the global badge's risk vocabulary. */
function badgeRiskForState(state: Handover["state"]): string {
  if (state === "accepted") return "nominal";
  if (state === "expired") return "blocking";
  return "elevated";
}

function ProgressPips({ total, cleared }: { total: number; cleared: number }) {
  if (total === 0) {
    return <p className={styles.progressNone}>Nothing requires acknowledgement.</p>;
  }
  return (
    <ul
      className={styles.pips}
      aria-label={`${cleared} of ${total} items acknowledged`}
    >
      {Array.from({ length: total }, (_, i) => (
        <li key={i} className={styles.pip} data-filled={i < cleared} />
      ))}
    </ul>
  );
}

function SettledSummary({ handover }: { handover: Handover }) {
  return (
    <section className={styles.settled}>
      <span className="badge" data-risk={badgeRiskForState(handover.state)}>
        {handover.state}
      </span>
      <p className={styles.settledText}>
        {handover.state === "accepted"
          ? `${handover.incoming_actor_name} took custody from ${handover.outgoing_actor_name}, acknowledging ${handover.required_total} item${handover.required_total === 1 ? "" : "s"}.`
          : `A handover from ${handover.outgoing_actor_name} was superseded before ${handover.incoming_actor_name} accepted it. Its unacknowledged items remain open gaps.`}
      </p>
    </section>
  );
}

function StartHandover({
  actorId,
  busy,
  onStart,
}: {
  actorId: string | null;
  busy: boolean;
  onStart: (incomingActorId: string, windowHours: number) => void;
}) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [incomingId, setIncomingId] = useState("");
  const [hours, setHours] = useState(12);

  useEffect(() => {
    fetchRoster()
      .then(setRoster)
      .catch(() => setRoster([]));
  }, []);

  // Custody passes between operators; the supervisor decides and is never a party.
  const candidates = useMemo(
    () =>
      roster.filter((r) => r.kind === "user" && r.id !== actorId),
    [roster, actorId],
  );

  return (
    <section className={styles.start}>
      <h2 className={styles.startTitle}>End your shift</h2>
      <p className={styles.startMeta}>
        Compose everything still open into a carry-forward list and hand it to
        the operator taking over.
      </p>
      <div className={styles.startControls}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Incoming operator</span>
          <select
            className={styles.select}
            value={incomingId}
            onChange={(e) => setIncomingId(e.target.value)}
          >
            <option value="">Select…</option>
            {candidates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Window (hours)</span>
          <input
            className={styles.input}
            type="number"
            min={1}
            max={72}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value) || 12)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!incomingId || busy}
          onClick={() => onStart(incomingId, hours)}
        >
          {busy ? "Composing…" : "Compose handover"}
        </button>
      </div>
      {!actorId && (
        <p className={styles.startMeta}>Sign in to start a handover.</p>
      )}
    </section>
  );
}

function AddNote({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (title: string, detail: string | null, requiresAck: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [requiresAck, setRequiresAck] = useState(true);

  return (
    <section className={styles.addNote}>
      <h2 className={`section-label ${styles.groupLabel}`}>Add a note</h2>
      <p className={styles.addNoteMeta}>
        Anything the system cannot see — a smell, a contractor still on site, a
        gauge you do not trust.
      </p>
      <input
        className={styles.input}
        placeholder="What should the incoming operator know?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className={styles.queryInput}
        rows={2}
        placeholder="Detail (optional)"
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
      />
      <div className={styles.addNoteActions}>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={requiresAck}
            onChange={(e) => setRequiresAck(e.target.checked)}
          />
          Require acknowledgement
        </label>
        <button
          type="button"
          className="btn"
          disabled={!title.trim() || busy}
          onClick={() => {
            onAdd(title.trim(), detail.trim() || null, requiresAck);
            setTitle("");
            setDetail("");
          }}
        >
          Add note
        </button>
      </div>
    </section>
  );
}
