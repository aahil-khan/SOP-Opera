"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { ShiftGate } from "@/components/twin/ShiftGate";
import { DemoMenu } from "./DemoMenu";
import { SettingsMenu } from "./SettingsMenu";
import { TourLaunchButton } from "@/components/tour/TourLaunchButton";
import styles from "./TopNav.module.css";
import { displayName, initialsFor } from "@/lib/actorDisplay";
import { getActorFromCookie } from "@/lib/actorCookie";
import { logout } from "@/lib/authApi";
import type { Actor } from "@/lib/authTypes";
import { useLiveStore } from "@/lib/liveStore";

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const onOperator = pathname === "/operator";
  const onReports = pathname.startsWith("/reports");
  const onAiOps = pathname.startsWith("/ai-ops");
  const onEval = pathname.startsWith("/eval");
  const onHandover = pathname.startsWith("/handover");
  const onReviewDetail = pathname.startsWith("/reviews/");
  const selectAsset = useLiveStore((s) => s.selectAsset);
  const handover = useLiveStore((s) => s.handover);
  const loadHandover = useLiveStore((s) => s.loadHandover);

  // Cookie is only available in the browser — start null so SSR and the
  // first client render match, then hydrate from the cookie after mount.
  const [actor, setActor] = useState<Actor | null>(null);
  //(Handover id the operator chose to enter past, so the gate does not re-open
  // on every navigation once they have deliberately deferred it.)
  const [dismissedHandoverId, setDismissedHandoverId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setActor(getActorFromCookie());
  }, [pathname]);

  useEffect(() => {
    void loadHandover();
  }, [loadHandover, actor?.id]);

  // The gate belongs on the twin, where custody actually matters, and only when
  // a handover is genuinely waiting on this operator.
  const handoverOpen =
    onOperator &&
    handover?.state === "issued" &&
    handover.viewer_role === "incoming" &&
    handover.id !== dismissedHandoverId;

  async function onLogout() {
    try {
      await logout();
    } finally {
      setActor(null);
      router.replace("/login");
    }
  }

  const handleStartShift = useCallback(
    (attentionAssetId: string | null) => {
      setDismissedHandoverId(handover?.id ?? null);
      if (attentionAssetId) {
        selectAsset(attentionAssetId);
        if (!onOperator) router.push("/operator");
      }
    },
    [handover?.id, onOperator, router, selectAsset],
  );

  return (
    <>
      <nav className={styles.nav} aria-label="Primary">
        <Link href="/operator" className={styles.brand}>
          <Logo className={styles.brandLogo} />
          <span className={styles.brandName}>SOP Opera</span>
        </Link>

        <div className={styles.tabs} role="tablist">
          <Link href="/operator" className={styles.tab} data-active={onOperator}>
            Operator Dashboard
          </Link>
          <Link href="/reports" className={styles.tab} data-active={onReports}>
            Reports
          </Link>
          <Link href="/eval" className={styles.tab} data-active={onEval}>
            Eval
          </Link>
          <Link href="/ai-ops" className={styles.tab} data-active={onAiOps}>
            AI Ops
          </Link>
          <Link
            href="/handover"
            className={styles.tab}
            data-active={onHandover}
          >
            Shift Handover
          </Link>
          {onReviewDetail && (
            <span className={styles.tab} data-active="true">
              Review
            </span>
          )}
        </div>

        <span className={styles.spacer} />

        <div className={styles.toolbar}>
          <TourLaunchButton />
          <DemoMenu />
          <SettingsMenu />
        </div>

        {actor ? (
          <div className={styles.account}>
            <span className={styles.avatar} aria-hidden="true">
              {initialsFor(actor.name)}
            </span>
            <div className={styles.identity}>
              <span className={styles.identityName}>{displayName(actor.name)}</span>
              <span className={styles.identityRole}>{actor.role}</span>
            </div>
            <button type="button" className={styles.logoutBtn} onClick={() => void onLogout()}>
              Logout
            </button>
          </div>
        ) : null}
      </nav>
      {handoverOpen ? (
        <ShiftGate
          onClose={() => setDismissedHandoverId(handover?.id ?? null)}
          onStartShift={handleStartShift}
        />
      ) : null}
    </>
  );
}
