# Local storage, backend cache and index decision

Status: source-backed decision for the next planning slice, 12 November 2026.
Reviewed base: `757c7e6c338c7c875d3476a99f5270977c2f0efa`
(`frontend/prof-revisions-integration`). This document changes no implementation,
schema, dependencies or deployment. Evidence and source hashes are in
[the review record](../evidence/local-storage-cache-20261112.json).

## Decision

Retain native IndexedDB for temporary browser study results and the existing
encrypted historical cache. Retain Postgres for shared account and owner records,
the bounded Go provider cache for short-lived public prices, and the published
file archive for collected IDX history. Profile the actual paging, payload and
server-capacity costs before choosing a storage migration. Professor's SQLite
question warrants this comparison; it does not establish a missing local store.

SQLite remains an experiment option for a measured query workload or a future
native application. Neither browser SQLite nor a server SQLite cache is approved
for implementation by this document. The deployment target and premium API
specification remain missing inputs.

## Verified baseline and boundaries

All source links below refer to paths and line anchors at the reviewed base.
Defaults are source values, not a measurement of a deployed process.

| Layer | Verified behavior | Boundary or cost to preserve |
| --- | --- | --- |
| Temporary study results | [signal-study-storage.ts](../../frontend/web/src/analysis/signal-study-storage.ts#L7) opens `signalgen-study-temporary-1`, version 2; `batches` contains compact event tuples keyed by owner, run and symbol, with an owner size ledger in `sizes`. The 128 MiB cap counts serialized event bytes per owner. | The cap excludes IndexedDB overhead and other origin databases; it is not a guaranteed browser quota. Upgrading this temporary schema deletes old stores. These are derived, disposable results. An unavailable IndexedDB open rejects with a storage error. |
| Study paging | [studyEventPage](../../frontend/web/src/analysis/signal-study-storage.ts#L148) uses a primary-key prefix cursor and returns at most the requested page, normally 50 events. | It still visits every symbol record and event in the run to count and select that page. There is no event-level secondary index in this store definition; bounded React rows do not imply bounded read work. |
| Study cancellation and account cleanup | [storeStudySymbol](../../frontend/web/src/analysis/signal-study-storage.ts#L78) aborts its write transaction on cancellation; [historical-lifecycle.ts](../../frontend/web/src/data/historical-lifecycle.ts#L11) clears temporary results and encrypted history on identity changes and signals other tabs. | Owner keys support application isolation within one origin; they are not an authorization boundary against same-origin script access. Preserve transactional rollback, cancellation, cross-tab cleanup and failure feedback. Do not promise permanent study archives. |
| Historical browser cache | [historical-cache.ts](../../frontend/web/src/data/historical-cache.ts#L20) binds origin/user/installation scope, dataset ID/version/schema/checksum and expiry. [historical-crypto.ts](../../frontend/web/src/data/historical-crypto.ts#L55) compresses and AES-GCM encrypts OHLCV with authenticated binding metadata. [historical-store.ts](../../frontend/web/src/data/historical-store.ts#L14) bounds storage at 32 entries / 16 MiB ciphertext and guards commits with an epoch. | Cache lifetime is at most 15 minutes and server expiry, whichever is earlier. Keys are stored in the same browser database; encryption does not make hostile same-origin code harmless. Storage failure permits a verified network fetch rather than persisting plaintext fallback. |
| Online access and study execution | [screener-dataset.ts](../../frontend/web/src/analysis/screener-dataset.ts#L6) rechecks user and manifest online even on a historical cache hit. [signal-study.ts](../../frontend/web/src/analysis/signal-study.ts#L86) directly fetches and checks study snapshot content; [its execution loop](../../frontend/web/src/analysis/signal-study.ts#L365) runs worker features and backtest outcomes locally, calls private server scoring, then stores results. | The study path does not automatically reuse the encrypted screener cache. [Server signal evaluation](../../backend/internal/backtest/signals.go#L84) binds owner, grant, snapshot and rule. Local storage cannot issue grants, authorize an offline run or replace that private evaluator. Screen-only mode stores signals without computing future outcomes. |
| Provider cache | [cache.go](../../backend/internal/marketdata/cache.go#L16) uses in-memory entries and shared flights. Defaults: TTL 5 minutes, fetch timeout 15 seconds, 64 entries, 32,000 candles and 8 in-flight fetches. [API construction](../../backend/cmd/api/main.go#L93) uses those defaults. | This caches public OHLCV, not identities, private rules, grants or owner handles. It is process-local and loses contents on restart. One caller cancelling its wait does not cancel a shared upstream request. |
| Provider keys and invalidation | [candleOne](../../backend/internal/marketdata/cache.go#L117) keys symbol/provider symbol/exchange/currency/timeframe/lookback/output count; [history_cache.go](../../backend/internal/marketdata/history_cache.go#L18) additionally separates historical from latest data and keys exact UTC range endpoints. | Successful, validated data is TTL-pruned and size-bounded. Keys do not include archive generation. A new publication may remain hidden behind an existing cache entry until TTL expiry; this is documented behavior, not immediate invalidation. |
| Dataset and study handles | [dynamic.go](../../backend/internal/dataset/dynamic.go#L38) defaults to 15 minutes, 128 entries, 16 per owner and 32 MiB total. ID lookup uses a map with owner checks; [backtest.go](../../backend/internal/dataset/backtest.go#L65) scans entries for owner/context reuse and then checksum equality. [studies.go](../../backend/internal/api/backtests/studies.go#L174) freezes catalog/rule/config, keeps a process-local ID map and admits up to 32 contexts at this base. | Context reuse/capacity accounting and expiry pruning include scans. These are Go structures, not SQL tables. A SQL index cannot raise their capacity. [Batch release](../../backend/internal/dataset/study.go#L21) removes only the owner's study handles. Parallel capacity work must be reviewed separately against this snapshot. |
| Durable history publication | [sync.go](../../backend/internal/collection/sync.go#L38) builds/resumes an immutable generation and publishes only a successful complete run; [retention.go](../../backend/internal/collection/retention.go#L58) records retirement and switches `current.json` using [atomic JSON replacement](../../backend/internal/collection/runner.go#L300). Archive metadata is indexed in symbol maps, then [history reads](../../backend/internal/collection/sync.go#L182) read/verify a symbol file and filter its candles. | StoreProvider resolves the publication per request; existing requests retain their generation, with the provider cache TTL above. [Pruning](../../backend/internal/collection/retention.go#L75) serializes with sync, validates current/retired data and enforces retention grace. Do not replace these guarantees with a mutable shared file or unrestricted cleanup. |

## Browser and native SQLite comparison

| Option | Relevant benefit | Constraint and disposition |
| --- | --- | --- |
| Retain IndexedDB | Async structured records, transactions and native key/index support fit the current temporary result model. No second database runtime is needed. | First measure cursor/page cost and propose event chunks or compound event keys if needed; keep current behavior as fallback. [IndexedDB documentation](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API). |
| SQLite WASM with OPFS | SQL queries could help repeated multi-field local analysis, if a benchmark shows that workload dominates. | Requires a chosen VFS and browser/host validation. SQLite's `opfs` VFS uses workers and SharedArrayBuffer with COOP/COEP; `opfs-sahpool` avoids those headers but requires explicit coordination for concurrent clients. Do not apply headers globally without testing external charts/assets and login flows. Keep IndexedDB fallback and detect usable storage at runtime. [SQLite persistence documentation](https://sqlite.org/wasm/doc/trunk/persistence.md). |
| Native local SQLite | Could suit a separately requested desktop/agent process with a real durable filesystem and local SQL workloads. | This web app has no such deployment requirement. Native SQLite does not make a remote browser's store native. SQLite permits one writer per database at a time; shared multi-instance ownership data stays in Postgres. [SQLite deployment guidance](https://sqlite.org/whentouse.html). |

IndexedDB and OPFS remain origin storage subject to browser quotas, user deletion
and best-effort eviction. A persistence request can be denied; private browsing
may reduce storage or discard it on exit. A SQLite migration does not remove
those conditions. Proposed UX should expose storage availability/estimated usage,
handle quota errors, allow CSV export, and offer a shorter run. Retaining results
across sessions would require an explicit product policy, cleanup/export design
and tests before requesting persistent storage. [Browser storage policy](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## Search and index review

These are verified migration definitions, not evidence that a target deployment
has applied them or that its planner uses them. No database was queried and no
`EXPLAIN` timing was measured.

| Source-defined key/index | Query relationship checked in source |
| --- | --- |
| Catalog symbol primary key and provider-symbol uniqueness; universe membership primary key `(universe_id,symbol)` and position uniqueness | [Catalog migration](../../supabase/migrations/20260930041429_stock_universe.sql#L4); [repository](../../backend/internal/universe/repository.go#L19) lists active catalog rows ordered by symbol and resolves exact symbol members. This catalog query has no name-search predicate. |
| `stock_universes_owner_updated_idx(owner_user_id,updated_at desc,id)` | [Definition](../../supabase/migrations/20260930041429_stock_universe.sql#L31) aligns with the [owner list's filter/order](../../backend/internal/universe/repository.go#L43). |
| `user_rules_owner_updated_idx(owner_user_id,updated_at desc,id)` | [Definition](../../supabase/migrations/20260929041140_web_multi_user.sql#L60) aligns with [rule list filtering and order](../../backend/internal/rules/repository.go#L85). |
| `user_records` primary key `(user_id,kind,id)` and `user_records_recent(user_id,kind,created_at desc,id)` | [Definitions](../../supabase/migrations/20261027080957_journal_and_backtest_records.sql#L10) correspond to [detail/list queries](../../backend/internal/records/store.go#L66). No query-plan speedup is claimed. |
| `audit_events_target_id_idx(target_user_id,id desc)` | [Definition](../../supabase/migrations/20261006053327_operator_account_status.sql#L11) matches [target-scoped cursor paging](../../backend/internal/account/management_repository.go#L159). |

Operator account search is a separate workload:
[ListAccounts](../../backend/internal/account/management_repository.go#L48) uses
`position(lower(search) in lower(email))` or a UUID text substring, with role,
status and cursor filters. Do not add an ordinary B-tree on a displayed search
column and claim arbitrary substring acceleration. PostgreSQL B-trees serve
equality/ranges and some anchored patterns; trigram indexes support appropriate
`LIKE`/`ILIKE` predicates. Any rewrite must preserve literal wildcard handling,
case behavior, authorization and paging. Measure the exact predicate first,
then compare an expression-compatible index/query on disposable synthetic data.
[B-tree semantics](https://www.postgresql.org/docs/current/indexes-types.html),
[trigram predicates](https://www.postgresql.org/docs/current/pgtrgm.html).

Use representative row counts and selectivities, realistic owner skew and both
empty/short/long searches. Record `EXPLAIN (ANALYZE, BUFFERS)`, result equivalence,
write cost and index size in an authorized isolated database before proposing a
migration. `ANALYZE` executes the query; none was executed here.
[PostgreSQL EXPLAIN guidance](https://www.postgresql.org/docs/current/using-explain.html).

## Next design slices and acceptance gates

1. **Capacity and payload first.** Hand the measured hot paths to the separate
   capacity/performance worker. Preserve private scoring, snapshot ownership and
   full-symbol crossover/cooldown history; the server currently validates every
   eligible candidate timestamp. SQLite alone does not reduce uploaded feature
   vectors or transfer bytes. Require output parity, bounded cancellation,
   memory/storage limits and before/after stage measurements.
2. **Browser query experiment if justified.** Measure page/export latency and
   memory for 10/100/500-symbol fixtures at several event counts. Compare the
   existing store with IndexedDB chunk/count metadata or compound keys before
   adding SQLite. Preserve all horizons, statuses, timestamps, quota rollback,
   replacement size accounting and owner/run cleanup. Only an accepted measured
   improvement warrants a reversible migration and old-schema policy.
3. **Generation-aware cache proposal.** If measured TTL staleness is unacceptable,
   carry immutable generation identity into public cache keys or a deliberate
   invalidation boundary. Keep in-flight readers pinned, rollback, bounded
   eviction and owner handles separate. Test publication during active reads;
   never infer historical snapshot freshness from a cache hit.
4. **Server storage/index decision.** Profile archive open/hash/filter overhead
   and map scans on a legally available synthetic corpus. Consider a per-generation
   SQLite `(symbol,timestamp)` index only if range reads dominate and the server
   has durable local storage; benchmark against current per-symbol files first.
   Preserve checksums, provenance, exclusive publication, read-only API mounts
   and retirement grace. Shared replicas or ephemeral disks need a separate
   durable-store/distribution design, not an assumed local SQLite solution.
5. **SQL search plans.** Verify deployed migration state and database version on
   a later authorized target; test query-compatible indexes offline first. Add
   only demonstrated indexes with bounded search/paging and owner predicates.

These are proposed slices, not implemented optimizations. The prioritized
operational and external requirements are in [the remaining-gap plan](PROF_REMAINING_GAPS.md).
