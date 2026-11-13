# Landing and journal effects

The hero uses local React Bits GhostFibers source, with the supplied dark green dots palette. Below the hero, a separate GradientASCII background uses black, muted green and deep green. The old hero trace and chart preview were removed. The shader layers use DPR 1, render at most 30 frames per second each and stop while hidden or offscreen. Reduced motion shows static frames. CSS green surfaces remain if WebGL2 is unavailable. These are rendering limits, not measured loading-speed improvements.

The original four feature illustrations remain. Hover and keyboard focus animate the screening trace, rule contacts, journal check and access layers. Reduced motion keeps them still. Pricing retains its existing layout, backend prices, plan limits and actions, with no PixelCard wrapper.

The screening journal uses MagicBento with six data cards: saved price history, saved signals, BUY/SELL distribution, stock/rule coverage, most saved stock and most used rule. Data follows the existing filters. The chart retains individual stock/currency series, keyboard point selection and SGT date filtering. Counts describe saved snapshots. The original table, export and detail actions remain below.

React Bits source is adapted locally, with demo artwork omitted from MagicBento. Its license is included beside the components. No dependencies were added.

Verification uses synthetic accounts and API responses. No account data is seeded or written by these tests. Run `node scripts/test-landing-effects.mjs` from `frontend/web` for the public effects checks. Existing journal and workspace browser suites cover filtering, export, keyboard actions, layouts and navigation.

## Portfolio and workspace follow-up

The journal's large Bento card now shows cumulative realized portfolio P&L. The frontend reads `/api/v1/portfolio` and `/api/v1/portfolio/transactions`, and saves user-confirmed transactions through the existing versioned portfolio endpoint. Screening rows prefill a draft; they never create executions automatically. BUY adds holdings and SELL realizes P&L under the backend's long-only weighted-average policy, including fees. IDR and USD remain separate. Chart points mirror the same policy using exact rational arithmetic before display conversion, and preserve microsecond execution ordering. The server summary remains authoritative.

Dashboard shows realized totals from the same API. Screener performance timings open in the existing accessible InfoDialog, with grouped metrics and focus restoration. Workspace surfaces share the forest gradient roles documented in DESIGN.md.

Landing follow-ups add ShinyText to the bold first hero line, remove the preview label, extend animated ASCII to the transparent footer, remove the feature-section top gap, and add PixelCard only to testimonial cards. Dashboard navigation lives inside the landing account dropdown. Reduced motion keeps the headline and backgrounds static. There are no new package dependencies or backend source changes.
