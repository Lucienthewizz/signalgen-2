# Signalgen website design

## Purpose

Introduce the desktop analysis workspace to Indonesian independent investors, demonstrate explainable rule-based analysis, and provide a shared-account entry point.

## Tokens and direction

Manrope carries both product headlines and body copy. Content is left aligned with a 1200px maximum container; split layouts collapse to one column at 760px.

- Canvas: `#08090d`
- Foreground: `#eff0f6`
- Product surface: `#11131c`
- Primary action: `#c9d3ff`
- Supporting copy: `#a4a9bd`
- Dividers: `#2a2d3c`

Following the requested Linear reference, blue/lavender atmospheric gradients are concentrated around the desktop preview. The product image and feature exploration carry the page identity; supporting sections remain quiet.

## Page and interactions

The first viewport presents the analysis proposition, account creation, and a real desktop screenshot. An adapted Hyperiux interactive feature list lets visitors inspect rule-building, screening, backtesting, and explained signals. Touch, pointer, and keyboard users share the same information.

The entrance is one short copy/preview sequence rather than animation on every section. Pointer smoothing runs only during interaction. Reduced motion removes spatial animation. FAQ uses the official shadcn Base UI Accordion; forms use FieldGroup, Field, Input, Tabs, Button, and Alert.

## Content boundaries

Product previews are illustrative. Temporary testimonials are identified as fictional examples. Installer, price, and payment availability remain pending. Authentication follows `feature/backend-authorization` and supports email confirmation, validation, expired sessions, and recoverable transport failures.
