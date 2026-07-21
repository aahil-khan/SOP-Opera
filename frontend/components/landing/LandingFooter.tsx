"use client";

import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import styles from "./LandingFooter.module.css";

const STACK = [
  "Next.js",
  "FastAPI",
  "PostgreSQL + pgvector",
  "LangGraph",
  "WebSockets",
  "Hybrid RAG",
];

export function LandingFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.brandCol}>
          <Link href="/" className={styles.brand}>
            <Logo className={styles.brandLogo} />
            <span className={styles.brandName}>SOP Opera</span>
          </Link>
          <p className={styles.tagline}>
            Operational safety intelligence for high-risk industrial work.
          </p>
        </div>

        <div className={styles.stackCol}>
          <span className="section-label">Built with</span>
          <div className={styles.chips}>
            {STACK.map((s) => (
              <span key={s} className={styles.chip}>
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.bar}>
        <span>Demo build — seeded plant, simulated context providers.</span>
        <Link href="/login" className={styles.barLink}>
          Launch demo →
        </Link>
      </div>
    </footer>
  );
}
