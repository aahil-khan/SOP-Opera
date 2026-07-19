"use client";

import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import styles from "./LandingNav.module.css";

export function LandingNav() {
  return (
    <nav className={styles.nav} aria-label="Landing navigation">
      <div className={styles.left}>
        <Link href="/landing" className={styles.brand}>
          SOP Opera
        </Link>
        <span className={styles.subtitle}>Operational Safety Intelligence</span>
      </div>

      <div className={styles.right}>
        <a href="#how-it-works" className={styles.link}>
          Documentation
        </a>
        <a href="#simulator" className={styles.link}>
          Simulator
        </a>
        <a href="#built-for" className={styles.link}>
          About
        </a>
        <ThemeSwitcher />
        <button className={`btn ${styles.loginBtn}`} type="button">
          Login
        </button>
        <Link href="/" className="btn btn-primary">
          Launch Demo
        </Link>
      </div>
    </nav>
  );
}
