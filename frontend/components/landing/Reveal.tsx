"use client";

import type { ReactNode } from "react";
import { m, useReducedMotion } from "framer-motion";
import type { Variants } from "framer-motion";
import { rise, respectMotion, viewportOnce } from "@/lib/motion";

/**
 * Scroll-triggered reveal. Replaces the hand-rolled IntersectionObserver the
 * landing page used to run.
 *
 * Wrap a group in <Reveal stagger> and its <Reveal.Item> children inherit the
 * animation state, so only the parent observes the viewport.
 */
export function Reveal({
  children,
  className,
  variants = rise,
  delay = 0,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  variants?: Variants;
  delay?: number;
  as?: "div" | "section" | "li" | "span";
}) {
  const reduced = useReducedMotion() ?? false;
  const Tag = m[as];

  return (
    <Tag
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={viewportOnce}
      variants={respectMotion(variants, reduced)}
      transition={delay ? { delay } : undefined}
    >
      {children}
    </Tag>
  );
}

/**
 * A child of a staggering parent — inherits `hidden`/`visible` rather than
 * observing the viewport itself.
 */
export function RevealItem({
  children,
  className,
  variants = rise,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  variants?: Variants;
  as?: "div" | "li" | "span" | "article";
}) {
  const reduced = useReducedMotion() ?? false;
  const Tag = m[as];

  return (
    <Tag className={className} variants={respectMotion(variants, reduced)}>
      {children}
    </Tag>
  );
}
