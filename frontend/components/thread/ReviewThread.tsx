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

  const actorId = getActorFromCookie()?.id ?? null;

  const mentionedWorkerOptions = useMemo(
    () => workerRoster.filter((w) => w.id !== actorId),
    [workerRoster, actorId],
  );

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
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function onPost() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await postReviewComment(reviewId, {
        body,
        mentioned_worker_ids: Array.from(mentionedWorkerIds),
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
            const mentionNames = (c.mentioned_worker_ids ?? [])
              .map((id) => workerRoster.find((w) => w.id === id)?.name)
              .filter((name): name is string => Boolean(name));
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
                      <span key={name} className={styles.mentionTag}>
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
            placeholder="Write a note, and optionally mention workers."
          />
        </label>

        {mentionedWorkerOptions.length > 0 ? (
          <div className={styles.mentions}>
            <div className={styles.mentionsLabel}>
              Mention workers (optional)
            </div>
            <div className={styles.mentionList}>
              {mentionedWorkerOptions.map((w) => {
                const checked = mentionedWorkerIds.has(w.id);
                return (
                  <label
                    key={w.id}
                    className={styles.mentionChip}
                    data-checked={checked ? "true" : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(mentionedWorkerIds);
                        if (e.target.checked) next.add(w.id);
                        else next.delete(w.id);
                        setMentionedWorkerIds(next);
                      }}
                    />
                    {w.name}
                  </label>
                );
              })}
            </div>
          </div>
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
