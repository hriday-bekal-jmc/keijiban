import type { Variants, Transition } from 'framer-motion'

/**
 * One motion language for the whole app.
 *
 * Two rules make the difference between "animated" and "smooth":
 *
 * 1. Always state duration AND ease. Framer's default transition uses a tween
 *    for opacity but a spring for transforms, so a fade+slide finishes at two
 *    different moments — that mismatch is what reads as a snap at the end.
 * 2. Stagger lists with `staggerChildren`, never with per-item `delay` math.
 *    Variants let the parent own the timeline, so children stay in step and
 *    exit in order too.
 */

/** Soft ease-out — decelerates into place instead of stopping dead. */
export const EASE = [0.16, 1, 0.3, 1] as const

export const DUR = { fast: 0.14, base: 0.26 } as const

/** For controls that should feel physical (sliding pills, toggles). */
export const SPRING: Transition = { type: 'spring', stiffness: 480, damping: 32, mass: 0.7 }

/** Whole page or tab body arriving. No exit variant on purpose: waiting for an
 *  outgoing page to leave before the new one starts leaves a visible dead gap.
 *  The new content simply fades up over the old. */
export const pageFade: Variants = {
  hidden: { opacity: 0, y: 8 },
  show:   { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
}

/**
 * List and grid entrances are CSS, not variants — add `kb-list` / `kb-grid` to
 * the container (see index.css). framer orchestrates `staggerChildren` when the
 * container animates, so children that mount later (any list whose data arrives
 * after first paint) can be stranded at opacity 0 with nothing to advance them,
 * which renders as a page with a background and no content. CSS attaches the
 * animation per element, so it always completes.
 *
 * Keep framer for what it is actually better at: shared-layout transitions
 * (`layoutId` pills), gesture feedback (`whileTap`), and modal enter/exit.
 */

/** Swapping one block for another in place (skeleton → content → empty).
 *  Exit is deliberately quick so the crossfade never feels like waiting. */
export const swap: Variants = {
  hidden: { opacity: 0, y: 6 },
  show:   { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
  exit:   { opacity: 0, y: -4, transition: { duration: DUR.fast, ease: EASE } },
}
