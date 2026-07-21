"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { displayName, initialsFor } from "@/lib/actorDisplay";
import { getActorFromCookie } from "@/lib/actorCookie";
import { logout } from "@/lib/authApi";
import type { Actor } from "@/lib/authTypes";
import styles from "./SupervisorNav.module.css";

export function SupervisorNav() {
  const router = useRouter();
  const pathname = usePathname();
  const onReports = pathname.startsWith("/reports");
  const onSupervisor = pathname.startsWith("/supervisor");
  // Cookie is only available in the browser — start null so SSR and the
  // first client render match, then hydrate from the cookie after mount.
  const [actor, setActor] = useState<Actor | null>(null);

  useEffect(() => {
    setActor(getActorFromCookie());
  }, []);

  async function onLogout() {
    try {
      await logout();
    } finally {
      setActor(null);
      router.replace("/login");
    }
  }

  return (
    <nav className={styles.nav} aria-label="Supervisor">
      <Link href="/supervisor" className={styles.brand}>
        <Logo className={styles.brandLogo} />
        <span className={styles.brandName}>SOP Opera</span>
      </Link>

      <div className={styles.tabs} role="tablist">
        <Link
          href="/supervisor"
          className={styles.tab}
          data-active={onSupervisor}
        >
          Supervisor
        </Link>
        <Link href="/reports" className={styles.tab} data-active={onReports}>
          Reports
        </Link>
      </div>

      <span className={styles.spacer} />

      <div className={styles.toolbar}>
        <NotificationCenter />
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
  );
}
