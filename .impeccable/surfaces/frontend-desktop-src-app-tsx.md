---
version: 1
slug: "frontend-desktop-src-app-tsx"
primary_target: "frontend/desktop/src/App.tsx"
related_targets: ["frontend/desktop/src/styles.css","frontend/desktop/src/admin/AdminDashboard.tsx"]
---

# SignalGen Electron workspace

- Scope: Electron desktop user workspace and admin control surface.
- Mode: Operate.
- Audience: Indonesian retail-market users and product administrators working in long desktop sessions.
- Jobs: users inspect signals and analytical workflows; admins monitor accounts, roles, entitlement readiness, system health, audit activity, and desktop releases.
- Primary task: understand system state, identify exceptions, and move to the next operational action without exposing user-private trading data.
- Content constraint: admin data is clearly marked as preview until the endpoints in `backend/ADMIN_BACKEND_PRD.md` exist.

## Direction contract

THESIS: The desktop is an institutional control ledger where every row has provenance and every green state means verified. It refuses the generic SaaS dashboard made from equal metric cards and decorative glow.

OWN-WORLD: Matte black and near-black planes, paper-white type, graphite dividers, and a disciplined verification green that may move through one emerald-to-mint gradient rail. Components inherit Shadcn's composable primitives—button, badge, input, segmented filters, table, and side sheet—but use SignalGen's tighter geometry and operational density. Manrope Variable is the sole UI family; figures use tabular numerals.

STORY: A user sees market work and its explanation. An administrator sees the product as a controlled system: account posture, operational health, exceptions, and audited changes. Private rules, signals, and credentials never become admin content.

FIRST VIEWPORT: A 248px catalog sidebar anchors the left. A restrained top command bar names the current surface and provides role switching only when authorized or previewing. Admin overview opens with a wide operational statement, a thin live verification rail, a four-column ledger of account totals, then an asymmetric system-health matrix and action queue. User overview keeps the same shell and tokens, replacing the old red editorial hero with market trace, watchlist, and workflow evidence.

FORM: Grounded direction 6, Institutional Control Ledger, seed 39b14b51. Precision is raised by the data-sublime field, progressive disclosure by the deployable sheet, and catalog discipline by the Factory Records challenger; their costumes and conflicting palettes are not copied.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
