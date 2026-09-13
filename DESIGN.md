---
name: SignalGen 2.0
description: An editorial market terminal for readable, explainable IDX analysis.
colors:
  canvas: "#090a0c"
  surface: "#0e0f12"
  surface-high: "#141519"
  line: "#29292d"
  line-soft: "#1d1e22"
  text: "#f2f0ee"
  muted: "#aaa6a3"
  dim: "#777477"
  signal: "#e43d43"
  signal-bright: "#ff696e"
  positive: "#67ce98"
  caution: "#e1ae62"
typography:
  display:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "clamp(3.875rem, 6.35vw, 6.5rem)"
    fontWeight: 650
    lineHeight: 0.91
    letterSpacing: "-0.04em"
  editorial-accent:
    fontFamily: "Newsreader Variable, serif"
    fontWeight: 490
    lineHeight: 0.91
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "clamp(2.75rem, 5vw, 4.75rem)"
    fontWeight: 630
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 680
    lineHeight: 1.4
    letterSpacing: "0.08em"
rounded:
  compact: "6px"
  control: "10px"
  brand: "11px"
  panel: "15px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 19px"
    height: "49px"
  button-secondary:
    backgroundColor: "{colors.surface-high}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 19px"
    height: "49px"
  input:
    backgroundColor: "{colors.surface-high}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "48px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: SignalGen 2.0

## Overview

**Creative North Star: "The Editorial Market Terminal"**

SignalGen combines the composure of an editorial product with the precision and density of a market workstation. Its tinted near-black canvas, warm red signal color, fine structural lines, and exact data geometry support sustained analytical work without imitating a brokerage dashboard.

The public web surface extends the established desktop system rather than replacing it. Large statements explain the mechanism, bounded product demonstrations prove it, and compact operational details preserve the data-first character across landing, authentication, and account views.

**Key Characteristics:**

- Tinted near-black tonal layers separated primarily by fine borders and negative space.
- Warm red used deliberately for signals, actions, focus, and authored motion.
- Manrope-led operational typography with one restrained Newsreader italic accent.
- Real rule, chart, table, and status geometry instead of decorative finance motifs.
- Honest state language for illustrative data and unfinished commercial capabilities.

## Colors

The palette is warm, dark, and restrained: off-white text sits on near-black layers while signal red and semantic states remain scarce enough to carry meaning.

### Primary

- **Signal Red:** The primary action and signal color; reserve it for decisions, focus, active rule logic, and authored traces.
- **Signal Bright:** A brighter red for high-contrast emphasis, focus rings, chart paths, and the single editorial accent.

### Secondary

- **Positive Green:** Confirmed, connected, successful, or upward states; always pair it with text or shape.
- **Caution Amber:** Neutral-watch and caution states in analytical data.

### Neutral

- **Terminal Canvas:** The page and workspace ground.
- **Working Surface:** The default bounded panel layer.
- **High Surface:** Hovered fields, stronger panels, and local elevation.
- **Primary Text:** Headlines and important values.
- **Muted Text:** Supporting prose and secondary labels.
- **Dim Text:** Metadata and quiet operational copy that remains legible.
- **Structural Line / Quiet Line:** Grouping, division, and table rhythm before extra containers.

**The Scarce Signal Rule.** Red is a semantic cue, not ambient decoration; large areas stay neutral so actions and signals remain unmistakable.

## Typography

**Display Font:** Manrope Variable (with sans-serif fallback)

**Body Font:** Manrope Variable (with sans-serif fallback)

**Editorial Accent:** Newsreader Variable italic (with serif fallback)

**Character:** Manrope keeps controls, prose, and numerical information calm and exact. Newsreader appears only as a brief italic phrase inside a major statement, introducing editorial contrast without fragmenting the operational voice.

### Hierarchy

- **Display** (650, fluid 62–104px, 0.91 line-height): First-view statements with tight tracking and balanced wrapping.
- **Headline** (630, fluid 44–76px, 0.98 line-height): Major section statements.
- **Title** (640–680, 20–39px): Local panel, authentication, and account headings.
- **Body** (400, 12–16px, 1.65–1.78 line-height): Explanatory copy, generally constrained to roughly 610–660px.
- **Label** (650–740, 10–12px): Navigation, controls, statuses, and operational metadata; uppercase only for machine-like state labels.

Tabular numerals are mandatory for market prices, percentages, and aligned metrics. Compact data copy bottoms out at 10px on the public web surface.

**The One Editorial Phrase Rule.** Newsreader italic may emphasize one phrase in a major statement; it never replaces Manrope for controls, tables, or prose.

## Layout

The web surface uses a centered frame capped at 1420px with 40px desktop gutters, collapsing to 22px below 920px and 17px below 600px. Desktop compositions pair editorial copy with product mechanism; tablet and mobile stack them while preserving the explanation before the detailed terminal.

Spacing is generous at section scale and compact inside data objects. Borders create rows and groups before cards do. At 920px navigation becomes a disclosed menu, two-column authentication becomes a focused single-column form, and analytical flows turn vertical. The minimum supported viewport is 320px.

**The Mechanism-First Rule.** Product geometry must remain legible in the first viewport; responsive stacking may simplify density but may not remove the rule-to-signal explanation.

## Elevation & Depth

SignalGen is flat by default. Tonal layering and one-pixel borders provide most depth; only focal bounded demonstrations use broad, low-opacity black shadows. Resting navigation, tables, ledgers, and page sections remain unshadowed.

### Shadow Vocabulary

- **Focal Terminal:** `0 30px 90px rgba(0, 0, 0, .38)` for the hero terminal preview.
- **Product Canvas:** `0 28px 75px rgba(0, 0, 0, .34)` for a bounded workspace demonstration.

**The Flat-by-Default Rule.** Add shadow only when a bounded product mechanism must sit above the editorial page plane.

## Shapes

Controls use gently curved 9–10px corners; brand marks use 9–11px; product panels use 14–15px. Six-pixel corners are reserved for compact annotations, while pills and circular status markers are restricted to binary modes, people, or machine state. Borders are one pixel and low contrast.

**The Bounded Object Rule.** Rounded containers identify interactive or product-like objects, never ordinary page sections.

## Components

### Buttons

- **Shape:** Compact and deliberate with a 10px radius and 48–49px primary action height.
- **Primary:** Signal red with off-white text, a slightly brighter border, and horizontal padding of 19px.
- **Hover / Focus:** Hover brightens and lifts by one pixel; focus uses the bright signal ring; active returns to the page plane.
- **Secondary:** High-surface neutral fill with a structural border; hover increases contrast without becoming red.
- **Disabled:** Muted red-brown surface plus visibly reduced text contrast; it never relies on opacity alone.

### Chips

- **Style:** Fully rounded, compact, and tonal; use for authentication mode, active status, and narrow market states.
- **State:** Selection changes both foreground and surface. Semantic chips always carry readable text.

### Cards / Containers

- **Corner Style:** 14–15px only for bounded product demonstrations and operational panels.
- **Background:** Working Surface or High Surface over the Terminal Canvas.
- **Shadow Strategy:** Flat for ordinary panels; use a focal shadow only for a hero-level demonstration.
- **Border:** A single Structural Line; internal rows use Quiet Line.
- **Internal Padding:** Usually 18–24px, scaled down for compact data rows.

### Inputs / Fields

- **Style:** 48px high, 10px radius, High Surface fill, and a structural border.
- **Focus:** Border shifts to signal red while the global bright-red focus ring remains visible.
- **Error / Success:** Message blocks combine tinted surface, border, icon, and text; color is never the only cue.

### Navigation

Navigation uses compact Manrope labels, neutral text, and a thin red underline on hover. Active operational navigation uses a tinted red surface, border, icon, and a narrow signal bar. Below 920px, the public navigation becomes a full-width disclosed menu with account actions inside it.

### Rule-to-Signal Demonstration

The signature product component resolves three readable rule checks, draws the market trace, then reveals the explanatory tag and final signal state. Its completed state remains visible when reduced motion is requested.

## Do's and Don'ts

### Do:

- **Do** lead with readable rule logic, chart geometry, aligned market values, and explicit state labels.
- **Do** use borders and negative space before introducing another rounded container.
- **Do** keep numerical information tabular and compact operational copy at or above the established 10px floor.
- **Do** label illustrative market data and disclose unavailable pricing, payment, entitlement, or download states.
- **Do** preserve visible keyboard focus, text-backed status feedback, and a completed reduced-motion state.

### Don't:

- **Don't** use gradients, decorative finance imagery, oversized stock photography, or repeated icon-card grids.
- **Don't** turn red into a background wash or use green as an unlabeled promise of performance.
- **Don't** use Newsreader for controls, tables, body copy, or more than one editorial phrase per major statement.
- **Don't** fabricate prices, customer proof, performance claims, production downloads, or subscription availability.
- **Don't** exceed 6rem display type in ordinary layouts outside the shipped wide-screen hero exception.
