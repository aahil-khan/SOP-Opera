"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { m, useReducedMotion } from "framer-motion";
import { ConvergenceScene } from "./ConvergenceScene";
import { rise, riseFar, respectMotion, stagger, EASE_OUT } from "@/lib/motion";
import styles from "./HeroSection.module.css";

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

export function HeroSection() {
  const reduced = useReducedMotion() ?? false;

  return (
    <section className={styles.hero} id="hero">
      <div className={styles.backdrop} aria-hidden="true">
        <div className={styles.aurora} />
        <div className={styles.rings} />
        <div className={styles.sweep} />
        <div className={styles.baselines} />
        <div className={styles.vignette} />
      </div>

      <div className={styles.container}>
        <m.div
          className={styles.copy}
          initial="hidden"
          animate="visible"
          variants={stagger(0.09)}
        >
          <m.span
            className={styles.eyebrow}
            variants={respectMotion(rise, reduced)}
          >
            <span className={styles.eyebrowDot} />
            Industrial safety intelligence
          </m.span>

          <m.h1
            className={styles.heading}
            variants={respectMotion(riseFar, reduced)}
          >
            The signals were always there.
            <span className={styles.headingAccent}>
              Nothing was reading them together.
            </span>
          </m.h1>

          <m.p
            className={styles.description}
            variants={respectMotion(rise, reduced)}
          >
            Gas detection clears it. The permit is valid. Both workers are
            certified. Every system says yes — and the combination kills people.
            SOP Opera reads them as one picture, and turns what it finds into a
            decision somebody owns.
          </m.p>

          <m.div
            className={styles.actions}
            variants={respectMotion(rise, reduced)}
          >
            <Link href="/login" className={styles.primaryCta}>
              Launch the demo
              <span className={styles.ctaArrow} aria-hidden="true">
                →
              </span>
            </Link>
            <a
              href="#proof"
              className={styles.secondaryCta}
              onClick={(e) => scrollToSection(e, "#proof")}
            >
              See the numbers
            </a>
          </m.div>
        </m.div>

        <m.div
          className={styles.stage}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.2 }}
        >
          <ConvergenceScene />
        </m.div>
      </div>
    </section>
  );
}
