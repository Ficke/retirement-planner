# Dashboard Modernization Plan

The `/retire` dashboard is hand-rolled (custom `r-*` CSS, bespoke SVG charts, inline styles). The repo already ships the modern stack — shadcn/ui, Radix, Recharts, Tailwind v4, lucide-react, react-hook-form + zod — but `apps/web/src/components/retire/` doesn't use any of it. This plan rebuilds the dashboard on those primitives and applies modern design best practices.

## Architecture (the layered design system)

The design system is **already chosen and partially in place** — this plan finishes wiring it up. The layers, top to bottom:

| Layer | Role | Pick |
|---|---|---|
| Design tokens | colors, spacing, radius, typography | Tailwind v4 `@theme` + CSS vars |
| Primitives | accessible widgets (button, dialog, select, slider, popover, …) | **shadcn/ui** (Radix-based, source lives in this repo at `components/ui/`) |
| App composites | dashboard-shaped wrappers (`Stat`, `PageHeader`, `PageShell`, `KPIGrid`) | hand-built, thin, on top of shadcn — live in `components/retire/ui.tsx` |
| Charts | data viz | **Recharts** + shadcn `ChartContainer` / `ChartTooltipContent` |
| Forms | validation + state | **react-hook-form + zod** + shadcn `Form` |
| Tables / data grids | sort / filter / virtualize | shadcn `Table` (markup) + **TanStack Table** (logic) |
| Server / async state | fetching, caching, mutations | **Zustand** (current) — *not* TanStack Query |
| Routing | pages | Next.js App Router |
| Icons | iconography | **lucide-react** |

**Boundary rule.** Generic-shaped components live in `components/ui/`. Dashboard-shaped composites live in `components/retire/ui.tsx`. Use **`class-variance-authority`** (already installed; the same pattern shadcn uses for its variants) for any component that needs visual variants — no `if (hero) ...` branches in JSX.

**On TanStack.** TanStack is *not* a design system; it's a family of headless logic libraries that pair with shadcn at specific layers.
- **Table — yes**, for the Projections year-by-year grid (column defs, sorting, sticky header). Add `@tanstack/react-virtual` only if row count exceeds ~100.
- **Query — skip.** Zustand already owns async state; adding Query creates two parallel systems.
- **Form — skip.** RHF + zod is the chosen form lib.
- **Router — skip.** Next.js App Router owns routing.

## Goals

1. Replace custom primitives and SVG charts with **shadcn/ui** + **Recharts**.
2. Apply **8pt spacing**, consistent typography, and a single token system (Tailwind theme, not `--r-*` variables).
3. Hit a real **information hierarchy**: one clear hero metric per page, supporting KPIs equal-sized, no boilerplate copy.
4. Make charts **legible at default sizes** — nice-tick axes, capped y-scales, clamped tooltips, accessible labels.
5. Eliminate duplicated controls (e.g. retirement-age field on both Profile and Overview slider).

## Design principles

- **One source of truth per control.** A field appears either as a slider on Overview *or* a numeric input on Profile, never both.
- **Equal cards, equal weight.** No "hero" KPI that's 1.6× wider than its siblings unless the hero metric is the *only* thing in its row.
- **Charts read at a glance.** ≤ 7 y-axis ticks, axis labels in tabular figures, retirement marker as a labeled `ReferenceLine`, tooltips that never escape the card.
- **No filler text.** Subtitles describe data, not the UI ("As of May 8, 2026", not "Sliders update your plan and re-run the simulation").
- **Tokens, not inline styles.** Every color/spacing through Tailwind theme tokens; zero `style={{}}` for layout.
- **Accessibility.** Radix primitives give us focus rings, ARIA, keyboard nav for free — use them instead of `<button>` + `cursor: pointer`.

## Phase 1 — Charts (highest visual ROI)

Swap the three custom SVG charts for Recharts. This alone fixes the screenshots the user flagged.

- [ ] **WealthFanChart** → Recharts `ComposedChart` with two stacked `Area`s (P10–P90, P25–P75) and a `Line` for P50.
  - Y-axis: `tickFormatter` for $K/$M, max 6 ticks, `domain` capped at `min(p90Max, p75Max * 1.8)` so the median isn't crushed.
  - Retirement marker: `ReferenceLine` with label.
  - Tooltip: shadcn `ChartTooltip` (auto-clamps to container).
- [ ] **IncomeSourcesChart** → Recharts `AreaChart` with stacked areas, shared color tokens with the donut.
- [ ] **SensitivityChart** (3-up) → Recharts `LineChart` with `ReferenceDot` for current value.
- [ ] **ProbabilityRing / Donut / Sparkline / PercentileBars** → keep as small custom SVG (Recharts is overkill) but move to `components/ui/charts/` and use Tailwind tokens.

Delete `components/retire/charts.tsx` after migration.

## Phase 2 — Primitives & layout

Replace `components/retire/primitives.tsx` with shadcn equivalents:

| Custom | Replacement |
|---|---|
| `Card` (r-card) | `components/ui/card` |
| `KPI` | new `<Stat>` built on shadcn `Card` |
| `Chip` | `components/ui/badge` |
| `Toggle` | `components/ui/tabs` (segmented) or `ToggleGroup` |
| `SliderField` | `components/ui/slider` + `Label` |
| Custom `<select>` / `<input>` | `components/ui/select`, `components/ui/input` |
| `RadioPill` | `components/ui/toggle-group` (single) |
| `r-tbl` | `components/ui/table` |

Then strip the ~600 lines of `.retire-app .r-*` rules from `globals.css`.

## Phase 3 — Page-by-page polish

### Overview
- [ ] Equalize the 4 KPI tiles (drop the `1.6fr` hero column; if Plan Health is hero, give it its own row).
- [ ] Tweak copy: remove "Sliders update your plan and re-run the simulation" subtitle.
- [ ] Net Worth sparkline → Recharts `Sparkline` with same accent token.

### Profile (currently "plan.tsx")
- [ ] **Remove the Retirement age field** — it's a slider on Overview.
- [ ] Convert the 3-col grid to shadcn `Form` (`react-hook-form` + `zod`) for validation.
- [ ] Replace the manual currency `<input>` with a real masked input.
- [ ] Tax & Savings table → `components/ui/table`, no inline styled rows.

### Projections
- [ ] Model strip → shadcn `Card` with `Badge`s; drop the inline `style={{}}` wrapper.
- [ ] Year-by-Year table → shadcn `Table` (markup) + **`@tanstack/react-table`** (logic): column defs, sorting, sticky header. Virtualize via `@tanstack/react-virtual` only if rows exceed ~100.
- [ ] Chart toggle → shadcn `Tabs`.

### Sensitivity
- [ ] 3-up `Card`s with consistent height (currently uneven when one is loading).
- [ ] Use `Skeleton` instead of "Loading…" text.

### Assumptions
- [ ] `ModelOption` button → shadcn `Card` + `RadioGroup` (proper a11y).
- [ ] Two side-by-side cards must match height; align Donut card to the table card.

### Settings
- [ ] Engine select → shadcn `Select`.
- [ ] Seed mode pills → shadcn `ToggleGroup`.
- [ ] Drop the "Developer" status table — surface that info in a tooltip on the engine badge instead.

## Phase 4 — Tokens & theming

- [ ] Move `--r-accent`, `--r-pos`, `--r-neg`, `--r-warn`, `--r-c-taxable` etc. into the Tailwind theme as semantic tokens (`--color-success`, `--color-account-taxable`, …).
- [ ] Replace every `var(--r-*)` reference with a Tailwind class or `theme()` call.
- [ ] Delete the `.retire-app` CSS scope; the dashboard becomes a normal Tailwind surface.

## Phase 5 — Accessibility & polish

- [ ] Run axe on every page; fix any contrast or label issues.
- [ ] Keyboard test: Tab through Overview, sliders adjustable with arrows, tabs switch with arrows.
- [ ] Verify all Recharts tooltips and ReferenceLines render inside the card border.
- [ ] Loading states: every async surface uses `Skeleton`, not text.
- [ ] Empty states: real illustration or muted hint, not `r-empty`.

## Out of scope (this pass)

- Dark mode (already wired via `next-themes`; just verify after token migration).
- New pages or restructuring IA — sidebar grouping stays as-is.
- Backend / engine changes.

## Order of execution (suggested)

1. Phase 1 (charts) — biggest visible win, contained.
2. Phase 2 primitives swap — unblocks the rest.
3. Phase 3 page polish, top-down: Overview → Projections → Sensitivity → Profile → Assumptions → Settings.
4. Phase 4 token cleanup once nothing references `r-*` classes.
5. Phase 5 a11y sweep + screenshots before/after.

## Files most affected

- `apps/web/src/components/retire/charts.tsx` — delete after Phase 1
- `apps/web/src/components/retire/primitives.tsx` — delete after Phase 2
- `apps/web/src/components/retire/pages/*.tsx` — rewritten in Phase 3
- `apps/web/src/app/globals.css` — `.retire-app .r-*` block removed in Phase 4
- `apps/web/src/components/ui/charts/` — new directory for shared chart wrappers
