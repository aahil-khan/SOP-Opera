/**
 * Shared framer-motion variants.
 *
 * Durations/easing mirror styles/tokens.css (--duration-*, --ease-out) so motion
 * on the landing surfaces feels like the rest of the app rather than framer's
 * defaults. Keep new variants here instead of inlining transition objects.
 */

import type { Transition, Variants } from "framer-motion";

/** cubic-bezier(0.22, 1, 0.36, 1) — same curve as --ease-out. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const DURATION = {
  fast: 0.15,
  normal: 0.2,
  slow: 0.4,
} as const;

export const transition: Transition = {
  duration: DURATION.slow,
  ease: EASE_OUT,
};

/** Rise + fade. The default section/element reveal. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition },
};

/** Same as rise, but travels further — for hero-scale elements. */
export const riseFar: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition },
};

/**
 * Parent for staggered children. Pair with `rise` on each child — the child
 * inherits `hidden`/`visible` from the parent, so children need no `whileInView`.
 */
export function stagger(step = 0.07, delayChildren = 0): Variants {
  return {
    hidden: {},
    visible: {
      transition: { staggerChildren: step, delayChildren },
    },
  };
}

/** Standard viewport config: fire once, slightly before the element is centered. */
export const viewportOnce = { once: true, amount: 0.25 } as const;

/** Looser trigger for tall sections that would otherwise never hit `amount`. */
export const viewportTall = { once: true, amount: 0.15 } as const;

/**
 * Collapses a variant set to a plain fade when the user prefers reduced motion —
 * content still reveals, nothing travels.
 */
export function respectMotion(variants: Variants, reduced: boolean): Variants {
  return reduced ? fade : variants;
}
