"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { fetchRoster, loginAs, logout } from "@/lib/authApi";
import type { RosterEntry } from "@/lib/authTypes";
import { getActorFromCookie } from "@/lib/actorCookie";
import styles from "./page.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RosterEntry | null>(null);

  useEffect(() => {
    const actor = getActorFromCookie();
    if (actor) {
      router.replace(actor.kind === "user" ? "/" : "/supervisor");
      return;
    }
    void logout().catch(() => {});

    void fetchRoster()
      .then(setRoster)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected && roster.length) setSelected(roster[0]);
  }, [roster, selected]);

  async function onLogin() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await loginAs(selected.id);
      router.replace(selected.kind === "user" ? "/" : "/supervisor");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <header className={styles.header}>
          <Logo className={styles.brandLogo} title="SOP Opera" />
          <div className={styles.brandText}>
            <h1 className={styles.brandName}>SOP Opera</h1>
            <p className={styles.brandTagline}>Operational Safety Intelligence</p>
          </div>
        </header>

        <section className={styles.intro} aria-labelledby="login-heading">
          <p className="section-label">Acting as</p>
          <h2 id="login-heading" className={styles.title}>
            Select your identity
          </h2>
          <p className={styles.subtitle}>
            Choose an operator or supervisor profile to enter the Digital Twin demo.
          </p>
        </section>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className={styles.skeleton} aria-hidden="true">
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
          </div>
        ) : roster.length === 0 ? (
          <p className={styles.empty}>No identities available. Check that the backend is running.</p>
        ) : (
          <div
            className={styles.roster}
            role="radiogroup"
            aria-label="Select identity"
          >
            {roster.map((entry) => {
              const active = selected?.id === entry.id;
              const zones =
                entry.kind === "worker" && entry.owned_zones.length
                  ? `${entry.owned_zones.length} zone${entry.owned_zones.length === 1 ? "" : "s"}`
                  : null;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-active={active ? "true" : "false"}
                  className={styles.identity}
                  onClick={() => setSelected(entry)}
                >
                  <span className={styles.radio} aria-hidden="true" />
                  <span className={styles.identityBody}>
                    <span className={styles.identityTop}>
                      <span className={styles.identityName}>{entry.name}</span>
                      <span
                        className={`badge ${styles.kindBadge}`}
                        data-kind={entry.kind}
                      >
                        {entry.kind === "user" ? "Operator" : "Supervisor"}
                      </span>
                    </span>
                    <span className={styles.identityMeta}>
                      {entry.role}
                      {zones ? ` · ${zones}` : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selected || busy || loading}
            onClick={() => void onLogin()}
          >
            {busy ? "Signing in…" : "Continue"}
          </button>
        </div>

        <p className={styles.footerNote}>
          Demo mode — pick any profile to explore the platform with role-appropriate views.
        </p>
      </div>
    </div>
  );
}
