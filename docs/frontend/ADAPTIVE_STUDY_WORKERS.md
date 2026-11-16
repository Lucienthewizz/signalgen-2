# Adaptive study workers

Signal study runs keep one engine pool for the lifetime of a run. The pool starts
with one worker and creates at most four workers only when a current batch has
enough public workload metadata: catalog size, batch size, candle count, and
required operand count. `navigator.hardwareConcurrency` is a hint, not a
guarantee; missing or low-device hints keep the single-worker baseline. An
optional `navigator.deviceMemory` hint caps small-memory devices at two workers.

Feature jobs for a prefetched batch are queued through the pool, while private
server scoring and result commits remain deterministic and in batch order. The
existing content/grant `PREFETCH_LIMIT` and backend capacity limits are
unchanged. The pool is disposed on completion, abort, timeout, worker failure,
or retry identity changes, so queued and active jobs cannot leak into a later
run.

The policy is conservative and does not prove a browser RAM budget. WASM heaps,
structured-clone copies, browser scheduling, and device memory telemetry need
separate measurement. Performance claims must compare alternating baseline and
adaptive runs in the same bounded environment.
