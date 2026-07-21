"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { getActorFromCookie } from "@/lib/actorCookie";
import { logout } from "@/lib/authApi";
import type { Actor } from "@/lib/authTypes";
import styles from "./SupervisorNav.module.css";

export function SupervisorNav() {
  const router = useRouter();
  const [actor, setActor] = useState<Actor | null>(() => getActorFromCookie());

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
        <span>SOP Opera</span>
      </Link>
      <span className={styles.divider} aria-hidden="true" />
      <span className={styles.viewLabel}>Supervisor</span>
      <span className={styles.spacer} />
      <NotificationCenter />
      {actor ? (
        <div className={styles.identityWrap}>
          <div className={styles.identity}>
            <span className={styles.identityName}>{actor.name}</span>
            <span className={styles.identityRole}>{actor.role}</span>
          </div>
          <button
            type="button"
            className={styles.logoutBtn}
            onClick={() => void onLogout()}
          >
            Logout
          </button>
        </div>
      ) : null}
    </nav>
  );
}
