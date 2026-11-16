# Adaptive study workers

Signal study runs keep one engine pool for the lifetime of a run. The pool starts
with one worker and creates at most four workers only when a current batch has
enough public workload metadata: catalog size, batch size, candle count, and
required operand count. `navigator.hardwareConcurrency` is a hint, not a
guarantee; missing or low-device hints keep the single-worker baseline. An
optional `navigator.deviceMemory` hint caps small-memory devices at two workers.

Feature jobs for a prefetched batch are queued through the pool, while private
server scoring, WASM outcome studies, storage, and result commits remain
deterministic and in batch order. This first pool therefore claims overlap for
feature computation only; outcome calls remain serial to preserve the existing
per-symbol commit and retry semantics. The existing content/grant
`PREFETCH_LIMIT` and backend capacity limits are unchanged. The pool is disposed
on completion, abort, timeout, worker failure, or retry identity changes, so
queued and active jobs cannot leak into a later run.

The policy is conservative and does not prove a browser RAM budget. WASM heaps,
structured-clone copies, browser scheduling, and device memory telemetry need
separate measurement. Performance claims must compare alternating baseline and
adaptive runs in the same bounded environment.

The native browser fixture exercises the real application worker, current-source
Go/WASM, and IndexedDB with synthetic API routes. It captures every stored
compact event tuple and every downloaded CSV line, normalizing only run timing,
request identity, and worker statistics; adaptive and baseline hashes must match.
It also mutates one stored value and requires the canonical hash to change, so a
missing-value comparison cannot pass. The artifacts and hashes are in
`docs/evidence/adaptive-study-workers-canonical.json`.

The bounded repeated benchmark uses two alternating pairs for 250 candles and
three operands, plus two pairs for 1,250 candles and five operands. The 250-candle
case stays at one worker under the `10,000` candle-operand admission threshold.
The heavy case reaches three outstanding feature jobs with four hinted logical
CPUs, but this controlled run did not demonstrate a speedup: adaptive feature
medians and end-to-end elapsed time were higher than the single-worker baseline.
That is expected evidence for keeping admission conservative, not a capacity
claim. `peakLive` and `terminated` are recorded after completion/navigation;
`peakActive` means outstanding scheduled feature jobs and demonstrates overlap,
not simultaneous CPU execution. The actual container limit was two CPUs,
separate from the mocked `navigator.hardwareConcurrency` hint. Full repeated
measurements, startup samples, source/WASM hashes, and limitations are in
`docs/evidence/adaptive-study-workers-benchmark.json`; there is no five-minute
guarantee.
