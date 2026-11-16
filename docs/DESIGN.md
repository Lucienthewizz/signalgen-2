---
name: Signalgen
description: An institutional control ledger for stock analysis.
colors:
  canvas: "#070a08"
  sidebar: "#090c0a"
  surface: "#0d110e"
  surface-2: "#111612"
  surface-3: "#171c18"
  line: "#252b27"
  line-soft: "#1a201c"
  text: "#f5f7f5"
  muted: "#a4ada7"
  dim: "#919b93"
  green: "#45e69f"
  green-bright: "#7af5bd"
  green-deep: "#168f5a"
  green-soft: "#9df8cc"
  danger: "#ff8585"
  warning: "#e8bf75"
  accent-ink: "#04120a"
  skeleton: "#1a211c"
  skeleton-resolve: "#29332d"
  workspace-canvas: "#090a0a"
  workspace-sidebar: "#101111"
  workspace-surface: "#141616"
  workspace-surface-2: "#1a1d1b"
  workspace-surface-3: "#1a1d1b"
  workspace-line: "#292c2b"
  workspace-line-soft: "#292c2b"
  workspace-text: "#f1f3f2"
  workspace-muted: "#a5ada8"
  workspace-mint: "#69e69c"
  workspace-mint-bright: "#69e69c"
  workspace-action: "#0d3926"
  workspace-action-ink: "#f1f8f3"
  workspace-accent-surface: "#173024"
typography:
  display:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: "clamp(44px, 5.4vw, 76px)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-.035em"
  headline:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: "clamp(32px, 3.5vw, 48px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-.035em"
  title:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: "29px"
    fontWeight: 600
    letterSpacing: "-.035em"
  body:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: "16px"
    lineHeight: 1.8
  label:
    fontFamily: '"Manrope Variable", sans-serif'
    fontSize: "13px"
    fontWeight: 650
  desktop-control:
    fontFamily: '"Manrope Variable", "Avenir Next", sans-serif'
    fontSize: "11px"
    fontWeight: 670
    lineHeight: 1
  workspace-heading:
    fontFamily: '"Saira", ui-sans-serif, sans-serif'
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-.025em"
  workspace-body:
    fontFamily: '"Inter Variable", ui-sans-serif, sans-serif'
    fontSize: "13px"
    lineHeight: 1.55
  workspace-navigation:
    fontFamily: '"Saira", ui-sans-serif, sans-serif'
    fontSize: "15px"
    fontWeight: 600
  workspace-data:
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace'
    fontSize: "13px"
    lineHeight: 1.6
rounded:
  workspace-control: "6px"
  workspace-panel: "10px"
  tag: "6px"
  web-control: "8px"
  desktop-control: "9px"
  panel: "12px"
  pill: "999px"
spacing:
  tight: "8px"
  control: "14px"
  mobile-gutter: "20px"
  panel: "24px"
  gutter: "32px"
  feature-gap: "100px"
components:
  button-primary:
    backgroundColor: "{colors.green-bright}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.web-control}"
    padding: "14px 20px"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.web-control}"
    padding: "14px 20px"
  desktop-button:
    backgroundColor: "{colors.surface-2}"
    typography: "{typography.desktop-control}"
    rounded: "{rounded.desktop-control}"
    padding: "0 14px"
    height: "40px"
  proof-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel}"
  workspace-button-primary:
    backgroundColor: "{colors.workspace-action}"
    textColor: "{colors.workspace-action-ink}"
    rounded: "{rounded.workspace-control}"
  workspace-panel:
    backgroundColor: "{colors.workspace-surface}"
    textColor: "{colors.workspace-text}"
    rounded: "{rounded.workspace-panel}"
    padding: "{spacing.panel}"
  loading-placeholder:
    backgroundColor: "{colors.skeleton}"
    rounded: "{rounded.web-control}"
---

# Design System: Signalgen

## Overview

**Creative North Star: "The institutional control ledger"**

**Scope:** The original tokens and guidance below remain the public landing/auth and legacy desktop reference. The user-approved Pen workspace identity overrides them only for the eight routes listed in the scoped workspace section. Its normative tokens use the `workspace-` prefix; do not propagate them to public pages.

Signalgen presents analysis as a legible workspace: near-black surfaces, precise rules, compact controls, and green reserved for action and market state. The desktop establishes the visual world. The public web inherits its colors, Manrope typography, subtle edges, and supplied green candlestick mark, while using larger type and more breathing room.

**The Workspace Parity Rule.** The web is an operational extension of the desktop, not a marketing microsite: preserve the workspace sidebar, flat ledger dividers, mint verification accents, split authentication layout, and responsive drawer/stacking behavior. Build controls through the project-owned shadcn wrappers backed by Base UI; do not reintroduce carousels, testimonials, or magnetic effects. Interface copy uses sentence case.

**Key Characteristics:**
- Dark green-tinted tonal surfaces and fine dividers.
- Measured typography with tabular numbers.
- Product evidence and functional states rather than decoration.

## Colors

The palette combines quiet green-black neutrals with a luminous mint accent.

### Primary
- **Bright mint** (`green-bright`): public web actions, brand emphasis, selection, and focus.
- **Signal green** (`green`): desktop positive state and active controls. The web's CSS variable `--green` maps to bright mint; the desktop's `--green` maps to signal green. Preserve these existing surface mappings.
- **Deep green** and **soft mint**: restrained desktop traces and emphasis.

### Neutral
- **Canvas** and **sidebar** establish the foundation; **surface**, **surface-2**, and **surface-3** separate panels and controls.
- **Text**, **muted**, and **dim** separate information priority.
- **Line** and **line-soft** divide navigation, table rows, and sections.

### Semantic
- **Danger** communicates failure or destructive action; **warning** communicates attention or pending decisions. Status also needs text or an icon.
- **Skeleton** and **skeleton-resolve** belong to loading placeholders.

## Typography

**Display / Body Font:** Manrope Variable, with sans-serif fallback; desktop also falls back to Avenir Next.

The same family carries editorial headlines and dense analysis. Larger headings use tight tracking; numbers use tabular figures. Desktop controls remain compact, while public explanations use readable 14–16px body text.

### Hierarchy
- **Display:** public hero headline, maximum 1050px width. Mobile currently uses 42px.
- **Headline:** public section and closing headings.
- **Title:** feature headings; mobile reduces these to 26px.
- **Body:** landing introduction and hero copy, with hero copy limited to 590px.
- **Label:** public buttons and navigation. Desktop controls use their separate compact role.

**Sentence case rule.** Use sentence case for headings, labels, actions, and statuses. Preserve market tickers and standard abbreviations in their conventional form.

## Layout

The web uses a centered 1200px maximum container with 32px gutters. The header is 88px high. Hero spacing is 100px above and 60px below; a broad screenshot follows the hero. Intro and feature rows use two columns with 100px gaps and horizontal separators. Proof containers use 24px padding.

At 760px, web gutters become 20px and the header becomes 72px. Hero, feature, and account content stack; mobile navigation opens below the header. Desktop density has its own breakpoints at 1210px, 1020px, 860px, and 640px. At 860px its sidebar becomes an overlay. Wide desktop data tables keep horizontal scrolling on narrow screens.

Loading placeholders occupy the content footprint, so navigation and data transitions retain structure. Image loading uses a skeleton beneath the screenshot until the image resolves.

## Elevation & Depth

Tonal layering and one-pixel borders provide most depth. Public proof panels are flat. Desktop primary buttons have a restrained green shadow, segmented selection has a dark shadow, and sheets/artifacts use stronger separation where they overlap or stand apart. Do not apply the desktop overlay shadows indiscriminately to landing sections.

## Shapes

Controls have modest 8–9px corners. Proof and account panels use 12px corners. Desktop badges are pill-shaped; public signal tags use 6px corners. Borders and section rules provide structure without enclosing every paragraph in a card. The supplied raster candlestick mark appears without an added icon tile or gradient frame.

## Components

### Buttons
Public buttons use 14px by 20px padding, 8px corners, and a one-pixel border. Primary actions use bright mint with dark ink; hover becomes lighter mint. Secondary buttons use surface-2 with a restrained brighter hover. Desktop buttons use a 40px minimum height, compact typography, and 9px corners; their primary variant retains its existing green gradient. Visible keyboard focus uses a 2px mint outline. Disabled actions retain a distinct disabled state.

### Inputs / Fields
Public account fields use canvas, a one-pixel stroke, 7px corners, and 13px padding. Desktop fields use surface and 9px corners. Keep labels visible, preserve the mint caret, and provide visible focus and error feedback.

### Navigation
Public navigation is quiet 13px type with a brighter active route and mint hover. Mobile navigation is a dark panel below the header. Desktop navigation belongs to the persistent sidebar and becomes a drawer on small screens.

### Chips / Status
Desktop badges combine a small state dot, text, tonal fill, and colored border. Public signal proof uses a compact green tag. Color alone must not communicate status.

### Cards / Containers
Proof and account containers use surface, line borders, 12px corners, and 24–32px padding. Feature text stays directly on the canvas, organized by rules and spacing.

### Product proof and loading
The screenshot sits in a restrained window frame with an explanatory caption. Feature proofs expose rule configuration, workflow steps, and signal values. Skeletons use the two established loading colors with a 1.3s alternating pulse; reduced-motion preferences stop the pulse. Loading regions should expose an accessible loading description without exposing decorative skeleton geometry to assistive technology.

## Do's and Don'ts

### Do:
- **Do** inherit the desktop palette and typography on public surfaces.
- **Do** use the supplied green candlestick mark consistently.
- **Do** preserve sentence case and tabular market numbers.
- **Do** show product evidence and honest state labels.
- **Do** preserve content geometry during loading and respect reduced motion.

### Don't:
- **Don't** substitute Linear's brand identity for Signalgen's world.
- **Don't** decorate every section with a raised card.
- **Don't** rely on color alone for success, warning, or failure.
- **Don't** disguise illustrative market values as live data or pending releases as available installers.

## Pen workspace identity

The 16 November black/green Pen frames establish a flat, neutral-black workspace with dark-green actions. This replaces the earlier forest gradient treatment for `/#app/overview`, `/#app/analysis`, `/#app/backtest`, `/#app/journal`, `/#app/rules`, `/#app/universes`, `/#app/realtime`, and `/#app/news`. The landing page and authentication keep their current identity. Implementation authority is `frontend/web/src/styles/pen-workspace.css`, scoped to `.pen-workbench` and `html[data-typography="workspace"]`.

### Colors

Use the prefixed workspace tokens above for dark mode: charcoal canvas, progressively lighter panel surfaces, fine neutral dividers, pale text, dark-green primary actions, and restrained green accents. Preserve semantic gain, loss, warning, disabled, and focus states. The product remains dark-only; the new reference supersedes the earlier workspace light adaptation.

### Typography

Headings, navigation, buttons, and summaries use Saira (600). Explanatory copy and form text use Inter Variable. Tables and financial values use IBM Plex Mono (400/600) with tabular figures. Page headings are 28px on desktop and 25px at 520px and below; table values use 13px. The font files are local assets. These roles supersede Manrope only within the workspace.

### Layout

The expanded desktop sidebar is 224px; the collapsed sidebar is 76px. At 860px and below it becomes the existing overlay drawer. Workspace gutters step from 32px to 20px, then 18px at 520px. Panels typically use 24px padding and gaps. Rules place the composer on the left and the saved-rule library on the right, stacking at 1100px. The library follows the composer height and paginates its compact 88px rows. Compact universe catalog and News columns stack at 1000px; Dashboard shortcuts and monitor columns stack at 860px. The study guide stacks at 1180px. Journal, Screener and Market Monitor tables wrap within their cards and become labelled records below a 760px container width. Preserve all fields and existing form behavior.

### Elevation & Depth

Resting workspace panels are flat, with tonal separation and one-pixel borders. Page and card gradients are disabled. Existing ReactBits components and interaction logic remain available within the adapted composition; this scoped identity does not inherit the earlier blanket prohibition on carousels or animated components.

### Shapes

Workspace controls use 6px corners and panels use 10–12px corners. Dashboard resource cards use 12px corners and inset copy. Preserve the supplied Signalgen mark, visible focus, status labels, and reduced-motion behavior.

### Components

Primary actions use dark green with pale text. Mint remains reserved for readable accent text, selection and positive data. Active navigation combines mint text with a darker green surface. Inputs use the page-black control background and neutral border. Primary hover uses #124A31, pressed uses #092B1C, and focus uses a 2px #69E69C outline with 2px offset. Disabled controls use a neutral dark surface and muted text. Tables use subdued headers, fine row dividers, and monospaced data. Account menus, dialogs, screening, studies, portfolio calculations, and API ownership retain their existing behavior.

### Do's and Don'ts

- **Do** apply this identity only to the eight authorized workspace routes.
- **Do** keep Saira for headings/actions, IBM Plex Mono for data, and Inter for prose.
- **Do** retain keyboard focus, responsive navigation, semantic states, and reduced-motion support.
- **Don't** extend this redesign to landing/auth or replace financial and account logic to match a visual reference.
- **Don't** treat synthetic preview data as evidence of a live backend or market feed.

The workspace extension sidecar is `frontend/web/.impeccable/design.json`. The root `.impeccable/design.json` and config contained pre-existing unrelated state and are not updated by this redesign. Route composition, evidence, and rollback details live in `docs/frontend/PEN_WORKSPACE_REDESIGN.md`.
