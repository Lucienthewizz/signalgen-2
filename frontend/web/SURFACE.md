# Signalgen Web Surface

The web UI deliberately shares the desktop application's visual grammar:
Manrope, `#070a08` canvas, green verification accents, flat ledger dividers,
compact controls, and a fixed workspace sidebar on wide screens.

## Routes

- `#home` — public workspace overview with clearly labelled demonstration data.
- `#login` and `#register` — backend-authorized account entry.
- `#forgot-password` — neutral password recovery request.
- `?view=reset-password` — Supabase recovery callback and new-password form.
- `#account` — authenticated identity summary.

## Interaction rules

Motion is limited to the loading indicator, backend verification rail, and final
point on the market trace. `prefers-reduced-motion` removes these animations.
The sidebar becomes an explicit drawer below 860px; auth becomes a single-column
form and all primary actions remain visible at 390px.

The UI uses project-owned shadcn Base UI primitives for buttons, inputs, fields,
labels, and alerts. Decorative marketing carousels, magnetic buttons, fictional
testimonials, and unused animation runtimes are intentionally excluded.
