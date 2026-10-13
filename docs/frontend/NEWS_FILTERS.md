# News filters

The existing public news endpoint is unchanged. Search operates on the returned
headlines in the browser, combining all search words and an optional ticker from
the account's saved Market Monitor watchlist. The starter watchlist is used when
no watchlist has been saved; an explicitly empty watchlist stays empty.

Ticker and known company names match whole words. This is not article-body,
sentiment or exhaustive issuer analysis. The interface states that limitation.
No results offers a reset action; cached-news warnings remain visible separately.
Video selection and the current curated videos are unchanged.

Verification: headline-filter unit tests, frontend typecheck/build, and isolated
Playwright CLI fixtures covering ticker/search/reset and desktop/mobile themes.
Browser fixtures do not change a real account or the external news provider.
