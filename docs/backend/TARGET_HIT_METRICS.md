# Target-hit statistics

The signal study now reports a target counter separately from win rate. Window
metrics include the optional nonnegative integer `target_hits` when take profit
is configured. The counter is available for the whole processed study, each stock,
and each signal day. Exact Open/High/Close horizon metrics do not include it.

## Meaning and denominator

| Configuration | UI label | Numerator | Denominator |
| --- | --- | --- | --- |
| TP only | Target reached rate | Outcomes with `status == take_profit` | Evaluated window outcomes |
| TP and SL | TP exit rate | TP outcomes that resolve before SL or time exit | Evaluated window outcomes, including SL and time exits |
| No TP | Unavailable | No target counter | No target rate |

Rate is `target_hits / evaluated * 100`. Incomplete outcomes are shown separately
and excluded from that denominator. A target touch can resolve a window before
its full horizon is available. A complete unhit window uses the final Close;
a positive time exit still contributes a win but contributes zero target hits.

With SL active, the metric measures **TP exits under the existing policy**.
If TP and SL both touch within one daily candle, SL wins and target_hits stays
zero. A later TP touch after an SL exit is not counted. The result does not claim
that the target was never touched at any later time; the study stops at its
first policy-resolved barrier. Daily OHLC identifies a hit candle, not intraday
time or a guaranteed broker fill. BUY/SELL direction, signal Close reference,
trading-candle horizon and existing return calculations remain unchanged.

Provider failures stay in separate stock coverage counts. Partial studies show
counts for all successfully processed signals, with processed/total stocks still
visible. Neither missing outcomes nor failed stocks are invented as zero returns.
These are independent signal observations, not portfolio returns.

## Aggregation and compatibility

The Go core increments the counter while processing every event, alongside the
existing whole-run, stock and day metrics. Frontend `mergeStudyMetrics` adds
numerators across all symbols and batches. Rates are derived from summed counts,
never averaged from per-stock percentages or calculated from the current page.
The 50-event result page is only a view into temporary storage.

`target_hits` is an optional response extension to `signal-study-1`, under the
unchanged `signal-close-independent-1` policy. No request, context, dataset,
authorization, worker protocol or execution-policy field changes. The existing
result decoder accepts additive fields. Old consumers can ignore the counter;
new clients tolerate older engines/results with no counter. An explicit zero
is serialized when TP is configured, including zero-signal studies; absence is
never interpreted as a known zero. A zero evaluated denominator displays `—`.

A nonempty legacy contribution without a counter makes a combined target metric
unavailable, even if other contributions have counters. The UI asks to reload
the updated engine and rerun the study, and disables the target summary export.
An empty accumulator contributes no unknown observations. No summary is silently
reconstructed from only the visible 50 events. Compact event storage and existing
event/horizon/coverage CSV formats are unchanged.

## Presentation and export

The panel shows a labelled target numerator/evaluated denominator and incomplete
count beside the existing win-rate/average-return comparison. Grouped stock/day
summaries include the same statistic when TP is configured. The target rate is
independent of the selected exact T+X and signal page.

**Export target-hit summary CSV** adds a separate export with study ID, metric
label, target_hits, evaluated, incomplete, signals, rate_pct, processed/total
stocks, the frozen window/TP/SL/policy and complete/partial coverage. It exports
full processed-study counts and is disabled while running or when counters are
unavailable. Existing event exports retain every exact horizon and window outcome.

## Verification

[Evidence and commands](../evidence/target-hit-metrics.md) record actual local
checks, deterministic values, compatibility cases and limitations. Historical
backtest-evaluation reports remain snapshots of their earlier delivery; this
change closes their recorded aggregate target-hit gap.
