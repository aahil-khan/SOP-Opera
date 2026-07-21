"use client";

import { Logo } from "@/components/brand/Logo";
import styles from "./LandingFooter.module.css";

export function LandingFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.left}>
          <Logo className={styles.brandLogo} />
          <span className={styles.brand}>SOP Opera</span>
          <span className={styles.version}>v0.1.0</span>
        </div>
        <div className={styles.links}>
          <a href="#how-it-works" className={styles.link}>Documentation</a>
          <a href="#technology" className={styles.link}>Architecture</a>
          <a href="#" className={styles.link}>GitHub</a>
          <a href="#" className={styles.link}>Privacy</a>
        </div>
      </div>
    </footer>
  );
}
