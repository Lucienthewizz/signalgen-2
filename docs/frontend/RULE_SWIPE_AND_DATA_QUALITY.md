# Rule actions and per-stock data quality

Saved personal rules use the supplied React Bits SwipeRow interaction, adapted to TypeScript and Signalgen's existing colors and Lucide icons. Motion is loaded with the lazy Rules route.

- Drag or swipe a rule left to reveal Edit and Delete. Edit and Delete are fixed 48px square buttons, centered in the drawer. A left arrow beside its name and a short instruction explain the gesture.
- Keyboard users can Tab to Actions, then press Enter or ArrowLeft to reveal the drawer. Tab reaches Edit and Delete; Escape closes it.
- Opening another row closes the previous drawer. Search, signal filters and pagination close it too.
- Swiping alone never deletes a rule. Delete opens the existing confirmation; Cancel keeps the rule. System rules remain read only and delete stays disabled offline.
- Reduced motion removes the settling animation while preserving the same actions and focus behavior.

The Data Quality dialog separates dataset-wide notes from stock-specific tables. Each stock's current intraday provider note is split into interval, session, requested period, excluded null rows, and excluded unfinished/out-of-session rows. Zero stays zero. Unknown provider wording stays visible verbatim; missing values are not inferred. Tables stack on narrow screens.

Screener column headings use the existing primary text color and bold weight, including No. No screening calculations or backend contracts change.

Verification uses synthetic account/API fixtures: per-stock parsing tests, mouse/touch/keyboard gestures, protected deletion, focus restoration, system-rule restrictions, responsive tables and existing workspace regressions. Screenshots and runtime outcomes are recorded in the task result; this document describes intended behavior rather than asserting every check passed.
