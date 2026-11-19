# Per-condition AND / OR

Each connector sits below its condition and joins it to the next condition. The
last condition has no connector. AND is evaluated before OR; the expression below
the editor shows the grouping, for example `1 OR (2 AND 3)`. Arbitrary parentheses
and nested groups are not part of this change.

The editor exposes only per-condition connectors. New rules start with AND.
Existing rules inherit their stored AND/OR until a connector is changed; the
legacy top-level field remains in the API for compatibility. Removing a condition
keeps the preceding connector and removes a trailing connector. Existing rules without overrides retain their
original AND/OR behavior. Preview, Screener and captured journal evidence describe
mixed matches without claiming every individual condition passed.

## API extension

`RuleCondition.next_logic` is optional and accepts `AND` or `OR`. It connects that
condition to the following condition; absent values inherit `definition.logic`.
The backend rejects unsupported values and connectors on the last condition.
The field is persisted in the existing definition JSON and included in its hash;
no database migration is needed. Deploy the updated Go API before using the new
selectors. Older strict decoders reject this field rather than applying a mixed
rule as a global AND/OR. Feature computation and private decision boundaries stay
as before; the client does not decide whether a rule matched.

## Checks

- `npm test`, `npm run build`, `npm run check:budgets`.
- `go test ./...` in the backend Docker test stage, with synthetic/in-memory
  services; environment-dependent integration tests keep their existing skips.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node scripts/test-mixed-rule-logic.mjs`.
  Uses synthetic accounts/API responses only: three-condition mixed rule, draft
  restore, save/reopen, preview, deletion, keyboard Select focus and 1218/390px
  layouts, full-width centered connectors, compact edit dialog and legacy OR
  preservation. Does not write to a user's real account.
- Core truth tables cover `A OR (B AND C)`, `(A AND B) OR C`, legacy AND/OR,
  connector validation/serialization, short-circuit behavior and private screening
  and backtest decisions. Rule-store tests cover persistence/versioned hash changes.

## Manual check

1. Create a blank rule and add three conditions.
2. Set the first connector to OR and the second to AND.
3. Check that the editor shows `1 OR (2 AND 3)`, then preview and save.
4. Reopen the rule and select it in Screener or Backtesting. A match can pass
   condition 1 alone, or both conditions 2 and 3.
5. Use View results in Backtesting to open the report; return with Back to setup.
