"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { m } from "framer-motion";
import { Logo } from "@/components/brand/Logo";
import { ThemeSwitcher } from "@/components/theme/ThemeSwitcher";
import { EASE_OUT } from "@/lib/motion";
import styles from "./LandingNav.module.css";

const LINKS = [
  { href: "#gap", label: "The gap" },
  { href: "#proof", label: "Proof" },
  { href: "#how", label: "How it works" },
  { href: "#architecture", label: "Architecture" },
];

function scrollToSection(e: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!href.startsWith("#")) return;
  const target = document.getElementById(href.slice(1));
  if (!target) return;

  e.preventDefault();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({
    behavior: reduced ? "auto" : "smooth",
    block: "start",
  });
  history.pushState(null, "", href);
}

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <m.nav
      className={styles.nav}
      data-scrolled={scrolled}
      aria-label="Landing navigation"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
    >
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <Logo className={styles.brandLogo} />
          <span className={styles.brandName}>SOP Opera</span>
        </Link>

        <div className={styles.links}>
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={styles.link}
              onClick={(e) => scrollToSection(e, l.href)}
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className={styles.actions}>
          <ThemeSwitcher />
          <Link href="/login" className={styles.loginLink}>
            Log in
          </Link>
          <Link href="/login" className="btn btn-primary">
            Launch demo
          </Link>
        </div>
      </div>
    </m.nav>
  );
}
