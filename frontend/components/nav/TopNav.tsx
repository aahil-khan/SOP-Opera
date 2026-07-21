"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { ShiftGate } from "@/components/twin/ShiftGate";
import { DemoMenu } from "./DemoMenu";
import { SettingsMenu } from "./SettingsMenu";
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
  const onReviewDetail = pathname.startsWith("/reviews/");
  const selectAsset = useLiveStore((s) => s.selectAsset);

  // Cookie is only available in the browser — start null so SSR and the
  // first client render match, then hydrate from the cookie after mount.
  const [actor, setActor] = useState<Actor | null>(null);
  const [handoverOpen, setHandoverOpen] = useState(false);

  useEffect(() => {
    setActor(getActorFromCookie());
  }, [pathname]);

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
      setHandoverOpen(false);
      if (attentionAssetId) {
        selectAsset(attentionAssetId);
        if (!onOperator) router.push("/operator");
      }
    },
    [onOperator, router, selectAsset],
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
          <button
            type="button"
            className={styles.tab}
            data-active={handoverOpen}
            onClick={() => setHandoverOpen(true)}
          >
            Shift Handover
          </button>
          {onReviewDetail && (
            <span className={styles.tab} data-active="true">
              Review
            </span>
          )}
        </div>

        <span className={styles.spacer} />

        <div className={styles.toolbar}>
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
          onClose={() => setHandoverOpen(false)}
          onStartShift={handleStartShift}
        />
      ) : null}
    </>
  );
}
