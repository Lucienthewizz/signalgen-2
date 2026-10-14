# Workspace alignment refinement

The screener run summary places stock count beside the rule title and aligns the
title/action center lines. System-rule descriptions no longer carry an empty
condition row. Mobile uses a separate full-width action row.

The current-subscription section is a rounded, padded surface. Its plan, feature,
quota and management surfaces have space around and between them; the inner ledger
is transparent so the outer surface remains visible. Backtest entitlement is not
presented as a usable page: the UI explicitly says the page is not yet available.
No access grants or commercial package terms were changed.

Manage package remains a semantic native disclosure, now with a full-row control,
right-side chevron, visible focus and descriptive secondary text. Cancellation
controls still require opening the section and confirming the existing action.

`--workspace-panel-gutter` defines shared 24px desktop / 20px mobile content
insets. Existing workspace headers, forms, screener explanations, technical data,
stock detail and monitor footnotes use it. Notes outside panels keep their parent
alignment instead of receiving an extra arbitrary inset. This is a bounded
workspace cleanup, not a claim that every public-page paragraph was redesigned.

Verification: 79 unit/contract tests, typecheck/build, browser theme/viewport
matrix, measured screener title/action alignment, result-caption/filter alignment,
monitor title/footnote alignment, subscription inset/radius, and management
disclosure interaction. Tests use synthetic accounts; backend and `.env` unchanged.
