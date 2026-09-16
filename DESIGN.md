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
rounded:
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
  loading-placeholder:
    backgroundColor: "{colors.skeleton}"
    rounded: "{rounded.web-control}"
---

# Design System: Signalgen

## Overview

**Creative North Star: "The institutional control ledger"**

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
