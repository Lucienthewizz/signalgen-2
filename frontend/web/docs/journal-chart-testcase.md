# Journal chart testcase

Open Screening journal and choose **Preview test data** in the Portfolio header. This local preview never saves transactions or changes the account's P&L.

All examples use IDX, IDR, 100 shares (1 lot) and zero fees:

| Stock | Entry |  Exit | Realized P&L | Cumulative P&L |
| ----- | ----: | ----: | -----------: | -------------: |
| BBRI  | 4,000 | 4,400 |      +40,000 |         40,000 |
| BBCA  | 9,000 | 9,300 |      +30,000 |         70,000 |
| TLKM  | 3,000 | 2,900 |      −10,000 |         60,000 |

The chart should contain Start plus three sale points. It rises twice, then falls to IDR 60,000. Select a point for trade details; use arrow keys and Enter to select another point. **Show my portfolio** returns to the account's records and preserves its selected filters.

On desktop, the Portfolio card and Most used rule card should end at the same height, including when the portfolio is empty or trade details are expanded. On mobile, the cards stack without horizontal page overflow.

Automated check: `node scripts/test-portfolio.mjs` with the local frontend and configured Playwright browser. It asserts the example's four chart points, keyboard selection, responsive card alignment, return to the empty real portfolio and zero preview writes, then runs the existing ledger checks using synthetic API data.
