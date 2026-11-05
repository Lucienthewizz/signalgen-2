# Heatmap color and size scenarios

All prices below are synthetic browser fixtures and the optional in-app preview. No real account, journal,
screening history, market feed, or backend record is modified.

| Fixture stock | Open | Close | Change | Expected color | Expected area |
| --- | ---: | ---: | ---: | --- | --- |
| BBCA | 100 | 110 | +10% | Green | Largest, equal to BBRI |
| BBRI | 100 | 90 | −10% | Red | Largest, equal to BBCA |
| TLKM | 100 | 105 | +5% | Green | Smaller than ±10%, equal to BMRI |
| BMRI | 100 | 95 | −5% | Red | Smaller than ±10%, equal to TLKM |
| ASII | 100 | 102 | +2% | Green | Smaller than ±5%, equal to ANTM |
| ANTM | 100 | 98 | −2% | Red | Smaller than ±5%, equal to ASII |
| INDF | 100 | 101 | +1% | Green | Smaller than ±2%, equal to AADI |
| AADI | 100 | 99 | −1% | Red | Smaller than ±2%, equal to INDF |
| PTBA | 100 | 100 | 0% | Neutral | Minimum area, shows 0.00% |
| ICBP | Missing | Missing | Unknown | Neutral | Minimum area, shows no price data |

## Area policy

Half the canvas area is reserved equally for readability. The remaining half
is allocated in proportion to absolute percentage change. This ensures larger
positive **or negative** changes get larger tiles, while zero/missing values
remain clickable. Size is not market cap, trading volume, or a buy/sell signal.

When every value is zero or missing, tiles have equal area. Missing values must
never display a fabricated 0%. Colors use the same rounded-zero threshold as
the price label.

## Acceptance checks

- Positive is green; negative is red, independent of the screening match result.
- Area order: ±10% > ±5% > ±2% > ±1% > zero/missing.
- Opposite signs with equal magnitude have equal area within pixel tolerance.
- Every tile remains inside its canvas, without overlapping another tile.
- Test 1–30 stocks, including a dominant move with all other stocks unchanged.
- Test desktop/mobile, both themes, sidebar transitions, resize, hide/show,
  keyboard selection, and chart synchronization.
- Live mode still uses actual screening snapshots. In Market monitor, choose
  **Preview test data** to inspect this scenario, then **Exit test preview** to
  restore the real universe and selected stock. The preview is clearly labelled,
  hides the real chart/history, and never persists simulated prices or selection.
- Hover or tap a tile for candle prices, change and snapshot time; Escape closes
  the details. Missing snapshots offer **Screen this universe**, which prefills
  the Screener without starting a run or changing the selected rule.

Run `npm test` and `npm run test:browser` from `frontend/web`.
Visual captures are written to `output/playwright/stock-heatmap-mixed-*.png`.
