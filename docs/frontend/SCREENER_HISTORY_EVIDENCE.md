# Screener history and evidence

Completed runs now save the version/hash and public user-rule definition used by
the actual API run, not whichever rule is currently selected. Stored snapshots
are validated and whitelisted. System-rule private definitions are not saved.
Older history without a definition remains reviewable without recalculating
evidence from the newest rule. Browser comparisons are explanatory; the server
decision remains authoritative, including cooldown behavior.

Stock detail contains per-condition evidence and keyboard focus moves to the
opened detail. The table stays compact. CSV exports only the currently visible
rows, includes candle time and rule version, and neutralizes spreadsheet formulas.

History compares the newest completed run with a selected previous run. Only
overlapping symbols are classified as newly/no-longer/still matching. Unpaired
symbols are listed separately, never classified as failures. Different or unknown
rule versions carry an explicit warning. History remains capped at ten runs and
30 days, using the existing workspace storage/sync contract.

Verification: unit tests for immutable evidence snapshots, secret-field stripping,
comparison scope and CSV escaping; typecheck/build; isolated browser fixtures for
restored history, stock detail and CSV download. No database migration or backend
change is required.
