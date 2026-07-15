"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DemoControls } from "@/components/demo/DemoControls";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import styles from "./TopNav.module.css";

export function TopNav() {
  const pathname = usePathname();
  const onTwin = pathname === "/";
  const onReports = pathname.startsWith("/reports");
  const onAiOps = pathname.startsWith("/ai-ops");
  const onReviewDetail = pathname.startsWith("/reviews/");

  return (
    <nav className={styles.nav} aria-label="Primary">
      <Link href="/" className={styles.brand}>
        SOP Opera
      </Link>
      <div className={styles.links}>
        <Link href="/" className={styles.link} data-active={onTwin}>
          Digital Twin
        </Link>
        <Link href="/reports" className={styles.link} data-active={onReports}>
          Reports
        </Link>
        <Link href="/ai-ops" className={styles.link} data-active={onAiOps}>
          AI Ops
        </Link>
        {onReviewDetail && (
          <span className={styles.link} data-active="true">
            Review
          </span>
        )}
      </div>
      <span className={styles.spacer} />
      <DemoControls />
      <NotificationCenter />
      <ThemeSwitcher />
      <Link href="/dev" className={styles.devLink}>
        Dev
      </Link>
    </nav>
  );
}
