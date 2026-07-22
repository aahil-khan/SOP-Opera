"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchRoster } from "@/lib/authApi";
import type { RosterEntry } from "@/lib/authTypes";
import { getActorFromCookie } from "@/lib/actorCookie";
import {
  fetchReviewComments,
  postReviewComment,
  type ReviewComment,
} from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import {
  insertMention,
  parseMentionedWorkerIds,
  removeMention,
} from "@/lib/threadMentions";
import styles from "./ReviewThread.module.css";

export function ReviewThread({ reviewId }: { reviewId: string }) {
  const commentEventSeq = useLiveStore((s) => s.commentEventSeq);
  const lastCommentReviewId = useLiveStore((s) => s.lastCommentReviewId);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [workerRoster, setWorkerRoster] = useState<RosterEntry[]>([]);
  const [mentionedWorkerIds, setMentionedWorkerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [busy, setBusy] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const actorId = getActorFromCookie()?.id ?? null;

  const mentionedWorkerOptions = useMemo(
    () => workerRoster.filter((w) => w.id !== actorId),
    [workerRoster, actorId],
  );

  const workerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workerRoster) map.set(w.id, w.name);
    return map;
  }, [workerRoster]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchReviewComments(reviewId);
      setComments(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId]);

  useEffect(() => {
    if (!lastCommentReviewId) return;
    if (lastCommentReviewId !== reviewId) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentEventSeq, lastCommentReviewId]);

  useEffect(() => {
    let cancelled = false;
    void fetchRoster()
      .then((roster) => {
        if (cancelled) return;
        setWorkerRoster(roster.filter((r) => r.kind === "worker"));
        setRosterError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setRosterError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Keep chip selection in sync when the user types/deletes @Names. */
  useEffect(() => {
    if (mentionedWorkerOptions.length === 0) return;
    const fromText = parseMentionedWorkerIds(draft, mentionedWorkerOptions);
    setMentionedWorkerIds((prev) => {
      const next = new Set(fromText);
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) {
        return prev;
      }
      return next;
    });
  }, [draft, mentionedWorkerOptions]);

  function toggleMention(worker: RosterEntry) {
    const selected = mentionedWorkerIds.has(worker.id);
    if (selected) {
      setDraft((d) => removeMention(d, worker.name));
    } else {
      setDraft((d) => insertMention(d, worker.name));
    }
  }

  async function onPost() {
    const body = draft.trim();
    if (!body) return;
    const fromText = parseMentionedWorkerIds(body, mentionedWorkerOptions);
    const mentionIds = Array.from(
      new Set([...mentionedWorkerIds, ...fromText]),
    );
    setBusy(true);
    setError(null);
    try {
      await postReviewComment(reviewId, {
        body,
        mentioned_worker_ids: mentionIds,
      });
      setDraft("");
      setMentionedWorkerIds(new Set());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.thread}>
      <div className={styles.header}>
        <h2 className={styles.title}>Thread</h2>
        <span className={styles.count}>
          {comments.length} comment{comments.length === 1 ? "" : "s"}
        </span>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.loading}>Loading…</p> : null}

      <div className={styles.list}>
        <div className={styles.listInner}>
          {comments.length === 0 ? (
            <p className={styles.empty}>No comments yet.</p>
          ) : null}

          {comments.map((c) => {
            const mentionNames = (c.mentioned_worker_ids ?? []).map((id) => {
              const name = workerNameById.get(id);
              return name ?? id.slice(0, 8);
            });
            return (
              <article key={c.id} className={styles.comment}>
                <div className={styles.commentHeader}>
                  <div className={styles.author}>
                    {c.author_name}{" "}
                    <span className={styles.authorKind}>({c.author_kind})</span>
                  </div>
                  <div className={styles.when}>
                    {new Date(c.created_at).toLocaleString()}
                  </div>
                </div>
                <p className={styles.body}>{c.body}</p>
                {mentionNames.length > 0 ? (
                  <div className={styles.mentionTags}>
                    {mentionNames.map((name) => (
                      <span key={`${c.id}-${name}`} className={styles.mentionTag}>
                        @{name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>

      <div className={styles.composer}>
        <label className={styles.composerLabel}>
          <span className={styles.composerHint}>Add a comment</span>
          <textarea
            className={styles.textarea}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Write a note. Use the chips below or type @Name to tag someone."
          />
        </label>

        {rosterError ? (
          <p className={styles.error}>
            Could not load people to tag: {rosterError}
          </p>
        ) : null}

        {mentionedWorkerOptions.length > 0 ? (
          <div className={styles.mentions}>
            <div className={styles.mentionsLabel}>
              Tag people (optional) — they get a Mentions notification
            </div>
            <div className={styles.mentionList} role="group" aria-label="Tag people">
              {mentionedWorkerOptions.map((w) => {
                const checked = mentionedWorkerIds.has(w.id);
                return (
                  <button
                    key={w.id}
                    type="button"
                    className={styles.mentionChip}
                    data-checked={checked ? "true" : undefined}
                    aria-pressed={checked}
                    onClick={() => toggleMention(w)}
                  >
                    @{w.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : !rosterError ? (
          <p className={styles.loading}>Loading people to tag…</p>
        ) : null}

        <div className={styles.actions}>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setDraft("");
              setMentionedWorkerIds(new Set());
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !draft.trim()}
            onClick={() => void onPost()}
          >
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}
