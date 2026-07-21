"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { DemoMenu } from "./DemoMenu";
import { SettingsMenu } from "./SettingsMenu";
import styles from "./TopNav.module.css";
import { getActorFromCookie } from "@/lib/actorCookie";
import { logout } from "@/lib/authApi";
import type { Actor } from "@/lib/authTypes";

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const onTwin = pathname === "/";
  const onReports = pathname.startsWith("/reports");
  const onAiOps = pathname.startsWith("/ai-ops");
  const onEval = pathname.startsWith("/eval");
  const onHandover = pathname.startsWith("/handover");
  const onReviewDetail = pathname.startsWith("/reviews/");

  const [actor, setActor] = useState<Actor | null>(() => getActorFromCookie());

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

  return (
    <nav className={styles.nav} aria-label="Primary">
      <Link href="/" className={styles.brand}>
        <Logo className={styles.brandLogo} />
        <span>SOP Opera</span>
      </Link>
      <div className={styles.links}>
        <Link href="/" className={styles.link} data-active={onTwin}>
          Digital Twin
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
        <Link href="/handover" className={styles.link} data-active={onHandover}>
          Shift Handover
        </Link>
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
  );
}
