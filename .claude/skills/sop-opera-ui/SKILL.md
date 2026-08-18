---
name: sop-opera-ui
description: UI/UX conventions and verification loop for the SOP Opera frontend. Use when changing any file under frontend/ — styling, layout, copy, panels, themes, or visual polish. Covers the token/theme system, the operator-page density rule, the demo-legibility rules the hackathon judges score, and how to screenshot the running app before claiming a change works.
---

# SOP Opera — UI work

This is a near-complete hackathon finals product with an established design system. The job is almost always
**polish inside the existing system**, not a redesign. Read the system first, then make the smallest change
that fixes the actual problem.

## Before touching anything

1. `frontend/styles/tokens.css` — spacing, type scale, radius, motion, layout constants. Names only, no colors.
2. `frontend/styles/themes/*.css` — **all color values live here**, six themes:
   `mission-control` · `vscode-dark` · `github-dark` · `light` · `blueprint` · `catppuccin`.
3. `frontend/app/globals.css` — 8 lines, just the import order. Not a place to put rules.
4. `docs/comprehensive-guide.md` — the current, verified reference for what each surface does.

## Hard rules

**Every change must survive all six themes.** A literal hex in a `.module.css` looks right in whatever theme
you happened to be viewing and breaks in the other five. Use `var(--…)` from a theme file, or
`color-mix(in srgb, var(--token) N%, transparent)` for tints. (25 modules already contain literal hex — that
is pre-existing debt, not licence to add more. If you touch one of those files, fixing its hex is welcome.)

**Spacing, type, radius, and motion come from tokens.** `--space-*` (4px base), `--text-*`, `--radius-*`,
`--duration-*` + `--ease-out`. Ad-hoc `padding: 13px` is how a system rots.

**CSS Modules, colocated.** `Foo.tsx` + `Foo.module.css` side by side. No Tailwind, no styled-components,
no global classes. 82 modules follow this — match them.

**`frontend/shared/` is generated. Never edit it.** Source of truth is `shared/` at the repo root;
`node scripts/sync-shared.mjs` copies it. Editing the copy silently reverts on the next `npm run dev`.

**No threshold numbers in frontend code.** Sensor bands are backend-owned and hydrate from
`GET /api/config/thresholds` via `frontend/lib/sensorThresholds.ts`. Hardcoding `if (ppm > 25)` in a
component forks the number the eval harness measures against.

**Narrow Zustand selectors.** `lib/liveStore.ts` is large and hot, updated by every WebSocket event.
Subscribe to the minimum slice — past work specifically cut re-renders from hover, the overview feed, and
the notification badge. `useLiveStore((s) => s)` undoes that.

## The operator page is the hero, and it is already crowded

`app/operator/page.tsx` is the Digital Twin — the surface the demo runs on and the one judges watch.
Its floor plan must stay readable.

- New information goes **inside the Overview panel**, plus a collapsed badge if it needs an at-a-glance
  signal. It does **not** float over the twin, and it does not become a seventh always-open panel.
- Review case UI opens on the twin at `/operator?review={id}`. `/reviews` and `/reviews/[id]` are redirects.
- Guided tour owns `--z-tour: 10000`. There is no other z-index scale — don't invent one.

## Copy and legibility (this is scored)

The finals sheet weights UX 15% and "Presentation & Clarity" ~17%. Two rules carry most of it:

**Five-second scan.** A judge should understand a panel without reading prose. Headings carry the story;
plain nouns and states, not sentences. No paragraph leading a panel.

**Every user-visible claim needs a `file:line` behind it.** UI copy, page labels, README lines. If a judge
greps for the thing the label promises and it isn't there, the claim is a liability. Don't write a label
you can't point at code for.

**Anything synthetic is labelled in the product**, not just in the PR. Simulated telemetry, mock LLM
narration, seeded users — the UI says so. The mock LLM path in particular is surfaced as
"deterministic narration · no LLM configured" rather than implying reasoning; keep that honesty.

**Voice.** Active, sentence case, the same verb across a flow (a "Publish" button produces a "Published"
toast). Name things the way a plant supervisor would, not the way the schema does.

## Verify by looking, not by reasoning

Do not report a visual change as working without a screenshot. The stack:

```bash
./scripts/run-linux.sh            # full stack: Postgres + API :8000 + UI :3000
# or, if the DB and API are already up:
cd frontend && npm run dev        # :3000
```

Capture with the `webapp-testing` skill. On this machine Playwright lives in its own venv and drives system
Chrome — `~/.claude/skills/webapp-testing/.venv/bin/python`, and launch with
`p.chromium.launch(channel="chrome", headless=True)`. `chrome-devtools-mcp` is also installed for
interactive poking and Lighthouse/a11y passes.

Routes worth capturing for any cross-cutting change:
`/` · `/login` · `/operator` · `/supervisor` · `/reports/[id]` · `/notifications` · `/handover` ·
`/ai-ops` · `/eval`

For a theme or token change, capture at least `mission-control` and `light` — they are the extremes and
catch most contrast regressions. Theme is set by `data-theme` on the root element.

## Quality floor, unannounced

Responsive down to mobile, visible keyboard focus, `prefers-reduced-motion` respected, text contrast that
holds in all six themes. Build to it; don't narrate it.

## Companion skills

Chain these — they answer different questions and none of them knows this repo:

| Skill | Use it for |
| --- | --- |
| `refactoring-ui` | "This looks off." Visual hierarchy, spacing scale, grayscale-first, depth, dark-mode theming. Craft correctness. |
| `ux-heuristics` | "Is this usable?" Nielsen + Krug, severity-rated audit, dark patterns, WCAG. Run before shipping a flow. |
| `frontend-design` | Aesthetic direction when a surface needs a point of view, not a fix. Skip for small polish. |
| `dataviz` | Any chart or stat tile — `/eval`, `TrendForecastCard`, `DomainRadar`, `ImpactStrip`. |
| `webapp-testing` | Screenshotting the running app (see above). |
| `chrome-devtools-mcp:a11y-debugging` | Contrast, focus order, tap targets on a live page. |

Their scoring rubrics ("get to 10/10") are calibration aids, not goals. This codebase has real constraints —
six themes, a fixed token set, an owned backend contract — and those win over a generic rubric every time.
