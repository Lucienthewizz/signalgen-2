# Market Monitor insights

Closing prices now include the percentage move from that same candle's opening
price. This is explicitly not a previous-close/day-over-day return. Missing,
non-finite and non-positive opening prices never produce a percentage.

The table can be sorted by saved watchlist order, open-to-close percentage,
matching decision or candle time. Sorting does not mutate the saved watchlist or
change the selected chart. Unknown values sort after available values. Latest
snapshots are indexed once per history change rather than rescanning all history
for every table row.

Snapshots older than seven calendar days are marked old. This intentionally
conservative heuristic does not pretend to know IDX holiday/trading calendars.
Future timestamps beyond a five-minute clock allowance get a separate warning.
Underlying prices and decisions still come only from completed screening runs.

Verification: percentage/age edge-case tests, typecheck/build, browser fixture
checks for sorting, selection stability and desktop/mobile themes. No new backend
endpoint, provider request or database write is introduced.
