"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { ShiftGate } from "@/components/twin/ShiftGate";
import { DemoMenu } from "./DemoMenu";
import { SettingsMenu } from "./SettingsMenu";
import styles from "./TopNav.module.css";
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
          <span>SOP Opera</span>
        </Link>
        <div className={styles.links}>
          <Link href="/operator" className={styles.link} data-active={onOperator}>
            Operator Dashboard
          </Link>
          <Link href="/reports" className={styles.link} data-active={onReports}>
            Reports
          </Link>
          <Link href="/eval" className={styles.link} data-active={onEval}>
            Eval
          </Link>
          <Link href="/ai-ops" className={styles.link} data-active={onAiOps}>
            AI Ops
          </Link>
          <button
            type="button"
            className={styles.linkBtn}
            data-active={handoverOpen}
            onClick={() => setHandoverOpen(true)}
          >
            Shift Handover
          </button>
          {onReviewDetail && (
            <span className={styles.link} data-active="true">
              Review
            </span>
          )}
        </div>
        <span className={styles.spacer} />
        {actor ? (
          <div className={styles.identityWrap}>
            <span className={styles.identityChip} title={actor.role}>
              {actor.name}
            </span>
            <button type="button" className={styles.logoutBtn} onClick={() => void onLogout()}>
              Logout
            </button>
          </div>
        ) : null}
        <DemoMenu />
        <SettingsMenu />
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
