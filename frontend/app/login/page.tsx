"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
} from "framer-motion";
import { Logo } from "@/components/brand/Logo";
import { fetchRoster, loginAs, logout } from "@/lib/authApi";
import type { ActorKind, RosterEntry } from "@/lib/authTypes";
import { getActorFromCookie } from "@/lib/actorCookie";
import { zoneSummary } from "@/lib/zoneLabel";
import { EASE_OUT } from "@/lib/motion";
import styles from "./page.module.css";

/**
 * Two-stage sign-in: pick a role, then the person.
 *
 * The role split mirrors the actor kinds the backend issues — `user` runs the
 * operator dashboard, `worker` owns zones and clears tasks — so the viewer
 * understands there are two personas before they see two dashboards.
 */

const ROLES: Array<{
  kind: ActorKind;
  title: string;
  blurb: string;
  duties: string[];
  home: string;
}> = [
  {
    kind: "user",
    title: "Control Room Operator",
    blurb:
      "Watches the plant, reads the assessment, and records the decision that authorises or blocks work.",
    duties: ["Live plant map", "Reasoning trace", "Records decisions"],
    home: "/operator",
  },
  {
    kind: "worker",
    title: "Area Supervisor",
    blurb:
      "Owns specific zones. Receives the follow-up work a decision requires and clears it before work resumes.",
    duties: ["Zone task queue", "Raises concerns", "Closes out actions"],
    home: "/supervisor",
  },
];

function initials(name: string): string {
  return name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Strips the parenthetical role suffix seeded into some names. */
function displayName(name: string): string {
  return name.replace(/\s*\(.*?\)\s*/g, "").trim() || name;
}

export default function LoginPage() {
  const router = useRouter();
  const reduced = useReducedMotion() ?? false;

  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ActorKind | null>(null);
  const [selected, setSelected] = useState<RosterEntry | null>(null);

  useEffect(() => {
    const actor = getActorFromCookie();
    if (actor) {
      router.replace(actor.kind === "user" ? "/operator" : "/supervisor");
      return;
    }
    void logout().catch(() => {});

    void fetchRoster()
      .then(setRoster)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const people = useMemo(
    () => (kind ? roster.filter((r) => r.kind === kind) : []),
    [roster, kind],
  );

  // Preselect the first person whenever the role changes.
  useEffect(() => {
    setSelected(people[0] ?? null);
  }, [people]);

  const activeRole = ROLES.find((r) => r.kind === kind) ?? null;

  async function onLogin() {
    if (!selected || !activeRole) return;
    setBusy(true);
    setError(null);
    try {
      await loginAs(selected);
      router.replace(activeRole.home);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const slide = (dir: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, x: dir * 24 },
    animate: { opacity: 1, x: 0 },
    exit: reduced ? { opacity: 0 } : { opacity: 0, x: dir * -24 },
    transition: { duration: 0.32, ease: EASE_OUT },
  });

  return (
    <LazyMotion features={domAnimation} strict>
      <div className={styles.page}>
        {/* ── Brand rail ── */}
        <aside className={styles.rail}>
          <div className={styles.railGlow} aria-hidden="true" />
          <Link href="/" className={styles.brand}>
            <Logo className={styles.brandLogo} title="SOP Opera" />
            <span className={styles.brandName}>SOP Opera</span>
          </Link>

          <div className={styles.railBody}>
            <p className={styles.railHeading}>
              One operational view before every critical decision.
            </p>
            <p className={styles.railText}>
              Sensors, permits, maintenance state and worker movement, read
              together — so the combination that no single alarm sees becomes a
              decision someone owns.
            </p>
          </div>

          <div className={styles.railFoot}>
            <span className={styles.railPulse} aria-hidden="true" />
            Seeded demo plant · simulated context providers
          </div>
        </aside>

        {/* ── Selector ── */}
        <main className={styles.main}>
          <div className={styles.card}>
            <AnimatePresence mode="wait" initial={false}>
              {kind === null ? (
                <m.div key="roles" className={styles.stage} {...slide(1)}>
                  <header className={styles.stageHead}>
                    <p className="section-label">Step 1 of 2</p>
                    <h1 className={styles.title}>Who are you signing in as?</h1>
                    <p className={styles.subtitle}>
                      The two roles see different surfaces. Both are part of the
                      same review.
                    </p>
                  </header>

                  <div className={styles.roles}>
                    {ROLES.map((role) => {
                      const count = roster.filter(
                        (r) => r.kind === role.kind,
                      ).length;
                      return (
                        <button
                          key={role.kind}
                          type="button"
                          className={styles.role}
                          disabled={loading || count === 0}
                          onClick={() => setKind(role.kind)}
                        >
                          <span className={styles.roleTop}>
                            <span className={styles.roleTitle}>
                              {role.title}
                            </span>
                            <span className={styles.roleCount}>
                              {loading ? "…" : `${count} available`}
                            </span>
                          </span>
                          <span className={styles.roleBlurb}>{role.blurb}</span>
                          <span className={styles.duties}>
                            {role.duties.map((d) => (
                              <span key={d} className={styles.duty}>
                                {d}
                              </span>
                            ))}
                          </span>
                          <span className={styles.roleGo} aria-hidden="true">
                            Continue →
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </m.div>
              ) : (
                <m.div key="people" className={styles.stage} {...slide(-1)}>
                  <header className={styles.stageHead}>
                    <button
                      type="button"
                      className={styles.back}
                      onClick={() => setKind(null)}
                    >
                      ← All roles
                    </button>
                    <p className="section-label">Step 2 of 2</p>
                    <h1 className={styles.title}>
                      Sign in as {activeRole?.title.toLowerCase()}
                    </h1>
                    <p className={styles.subtitle}>
                      {kind === "worker"
                        ? "Each supervisor sees only the zones they own."
                        : "Full plant visibility across all three floors."}
                    </p>
                  </header>

                  <div
                    className={styles.people}
                    role="radiogroup"
                    aria-label="Select identity"
                  >
                    {people.map((entry, i) => {
                      const active = selected?.id === entry.id;
                      const zones = zoneSummary(entry.owned_zones);
                      return (
                        <m.button
                          key={entry.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          data-active={active}
                          className={styles.person}
                          onClick={() => setSelected(entry)}
                          initial={
                            reduced ? { opacity: 0 } : { opacity: 0, y: 8 }
                          }
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: 0.3,
                            ease: EASE_OUT,
                            delay: reduced ? 0 : i * 0.045,
                          }}
                        >
                          <span className={styles.avatar} aria-hidden="true">
                            {initials(entry.name)}
                          </span>
                          <span className={styles.personBody}>
                            <span className={styles.personName}>
                              {displayName(entry.name)}
                            </span>
                            <span className={styles.personMeta}>
                              {zones ? (
                                <>
                                  <span className={styles.supervises}>
                                    Supervises
                                  </span>{" "}
                                  {zones}
                                </>
                              ) : (
                                entry.role.replace(/_/g, " ")
                              )}
                            </span>
                          </span>
                          <span className={styles.check} aria-hidden="true" />
                        </m.button>
                      );
                    })}
                  </div>

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!selected || busy}
                      onClick={() => void onLogin()}
                    >
                      {busy
                        ? "Signing in…"
                        : `Enter as ${selected ? displayName(selected.name) : "…"}`}
                    </button>
                  </div>
                </m.div>
              )}
            </AnimatePresence>

            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}

            {!loading && roster.length === 0 && !error ? (
              <p className={styles.empty}>
                No identities available — check that the backend is running.
              </p>
            ) : null}
          </div>
        </main>
      </div>
    </LazyMotion>
  );
}
