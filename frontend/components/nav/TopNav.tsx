"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./TopNav.module.css";

export function TopNav() {
  const pathname = usePathname();
  const onTwin = pathname === "/";
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
        {onReviewDetail && (
          <span className={styles.link} data-active="true">
            Review
          </span>
        )}
      </div>
      <span className={styles.spacer} />
      <Link href="/dev" className={styles.devLink}>
        Dev seam
      </Link>
    </nav>
  );
}
