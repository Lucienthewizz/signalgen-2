# SignalGen — Backend & Portable Core MVP PRD

Versi 2.0 · 16 September 2026 · Target Go API + Go/WASM berdasarkan revisi voice memo. Owner: backend/core developer. [PRD utama](../PRD.md), [arsitektur](../PROJECT_CONTEXT.md), [FE PRD](../frontend/FRONTEND_MVP_PRD.md), [kontrak target](MVP_API_CONTRACT.md).

## 1. Outcome dan status implementasi

Pisahkan compute historis yang portable dari layanan server. Client menjalankan
indikator dan fitur berat melalui Go/WASM; decision kernel screener yang kecil dan
kritis diusulkan tetap di server. Batas final dipilih setelah eksperimen Model A/B
di [`HYBRID_SCREENER_DESIGN.md`](HYBRID_SCREENER_DESIGN.md). Server juga mengelola
principal, data berizin, rule, entitlement, sesi/perangkat, jurnal/portofolio dan
audit. Satu backend boundary, bukan microservice per fitur.

Simbol baseline yang dibaca: get_current_user di app/auth/dependencies.py memvalidasi bearer melalui Supabase; BacktestingEngine di app/engines/backtesting_engine.py fetch data, evaluate indicators/rule dan menyimpan run/signals lewat SQLiteRepository. Class tersebut mengeluarkan metrik jumlah signal, **bukan bukti seluruh jalur P&L/exit backtest telah dipetakan**. Pemilihan jalur baseline exact adalah gate M0.

Graph project signalgen-2.0 berstatus ready; coverage metadata generation 2026-09-13T06:07:50Z matching pada tiga file Python terpilih. Ini best-effort, bukan audit lengkap/freshness seluruh repo. Dokumen non-code yang berubah/untracked dibaca langsung. Jangan mengklaim role, entitlement, journal, Go API atau full authorization sudah ada dari pengecekan ini.

## 2. Arsitektur portable dan server

Struktur backend Go yang sedang dimigrasikan:

```text
backend/
  cmd/api          Go HTTP entrypoint
  cmd/wasm         Go js/wasm adapter
  core             pure indicator/rule/screen/backtest functions + schema
  internal/platform database/http/websocket adapters
  internal/api     thin HTTP composition and request/response adapters
  internal/auth    Supabase identity, auth service, and feature routes
  internal/account profile/status and Postgres repository
  internal/entitlement feature-access contract
  internal/operator audited privileged mutations
  internal/session app-session/device ownership and repository
  internal/rules   owner-scoped rule service and repository
  internal/dataset protected dataset contract and fixture
  internal/compute short-lived compute grants
  internal/screener one-use WebSocket tickets/private scoring transport
  internal/legacy  retired SQLite adapter for historical tests only
  app/             legacy Python reference, preserved during migration
supabase/migrations versioned application schema at repository root
```

Gin dipakai untuk route HTTP; handler mempertahankan kontrak JSON yang sudah digunakan frontend. Portable core tidak mengimpor HTTP, database, provider atau Supabase. Core menerima snapshot rule/data/config dan mengembalikan deterministic output. State indikator per-run/per-symbol, tidak global lintas pengguna/job.

## 3. Requirements

| ID | Tahap | Requirement | Acceptance criteria |
| --- | --- | --- | --- |
| BE-CORE-01 | P0 | Freeze exact baseline fixture | Rule/config/source path, data/version/checksum, signal/trade/metrics dan asumsi tercatat |
| BE-CORE-02 | P0 | Port subset core ke Go | Golden tests indikator/rule/signal dan execution metrics; unsupported ditolak |
| BE-WASM-01 | P0 | Compile WASM dan bridge contract | Versioned artifact/runtime/schema; worker run/error/cancel terintegrasi FE |
| BE-SPLIT-01 | P0 | Bandingkan split screener | Decision-kernel server dan satu alternatif diuji pada fixture sama; ukur correctness, CPU/RAM, network, latency, failure, dan exposure logika |
| BE-SOCKET-01 | P0 | Private scoring ringan | Ticket sekali pakai terikat user/session/grant/version; batch feature dibatasi; replay, expiry, revoke, mismatch, dan oversize ditolak |
| BE-DATA-01 | P0 | Authorized fixture distribution | Bearer/session/hak fitur diverifikasi; checksum/warmup/UTC konsisten |
| BE-AUTH-01 | P0 | Current principal + app session | Supabase token tervalidasi; status/session binding expiry/revoke diperiksa server |
| BE-OWN-01 | P0 | Ownership guards | A/B list/detail/update/delete/aggregate isolation; nested references divalidasi |
| BE-ENT-01 | P0 | Feature grants | screener/backtest berdasarkan server clock; expired/inactive denied; no payload role escalation |
| BE-EVAL-01 | P0 | Benchmark + threat model | Workload equal, both-side resource metrics, network/cold/warm dan batas lisensi dijelaskan |
| BE-AUTH-02 | P1 | Register/confirmation/refresh/recovery | Default role aman; profile creation/recovery idempotent; refresh rotation/provider failure handled |
| BE-RULE-01 | P1 | Rule subset CRUD/capabilities | System read-only; user owner; validation schema sama dengan core |
| BE-DATA-02 | P1 | Historical adapter/cache | Rights verified, normalized metadata, upstream rate limit/coalescing/timeouts, bounded datasets |
| BE-ENT-02 | P1 | Manual grants + audit | Restricted operator tool/CLI; reason/expiry mandatory; update+audit atomic |
| BE-DEVICE-01 | P1 | Device/session limit & revoke | Satu perangkat aktif; perpindahan maksimal sekali per 24 jam secara transaksional; session/user/device binding; revoke berlaku pada request berikutnya |
| BE-STORAGE-01 | P1 | Supabase Postgres migration/recovery | Versioned schema, ownership, RLS, backup/recovery, dan uji dua pengguna |
| BE-CACHE-01 | P1 | FE cache metadata/security handoff | Hash/version/user scope and key lifecycle jointly specified; no server secret shared |
| BE-JOURNAL-01 | P1 | Manual transaction CRUD | BUY/SELL decimal money/quantity, fees/time/currency, owner, optimistic concurrency/idempotency |
| BE-PORT-01 | P1 | Position/P&L authoritative | Recompute after mutation using ordered transactions/cost method; quote age/source exposed |
| BE-OPS-01 | P1 | Deployment/observability | Health/readiness, request IDs, safe logs, migration/backup and OpenAPI documented |

## 4. Correctness and baseline policy

M0 selects one strategy with one supported exit/sizing policy, not all legacy modes. Record exact engine/API path producing trade/P&L baseline; signal-only class output is not enough to invent trade metrics. Add golden snapshots before porting.

Tests cover chronological OHLCV, missing/duplicate candles, enough warmup, close completion/cooldown, timezone, splits/adjustments, fee/slippage, fills after signal without look-ahead, no trade, final open position, stop/target ordering if supported.

Rule and indicator formulas must match selected baseline. Integer/time/side/trade count comparisons exact. Float tolerance decided per metric before test; suggested abs/relative tolerance must be justified, never relaxed after mismatch. If baseline is incorrect, fix/spec change with paired fixtures rather than port bug silently.

No random results, no false success when a symbol fails. Partial results have explicit per-symbol warnings and status; fatal schema/data problems fail. Baseline and WASM run identical adjusted data/config, not separately fetched snapshots.

## 5. Authentication, authorization and licensing

Supabase retains identity/password. Go verifies token with a supported verification mechanism and issuer/audience/expiry as applicable; no unverified JWT decode as authentication. Profile/status/role/features authoritative in app storage; client-provided role/user_id/IP is not authority.

Authenticated setup returns opaque app-session token bound to verified user and registered browser installation. Business routes require bearer + app-session. Server stores token hash, expiry and revoked_at, not raw reusable session tokens in logs. Setup/refresh/list identity exemptions are explicitly listed in contract to avoid bootstrap deadlock.

P0 can seed users/grants through restricted local tooling; P1 grant tooling requires reason/expiry and atomic append-only audit. Operator does not automatically read other users' rules/journal. Production operator bootstrap out-of-band; no public make-admin or mark-paid.

Compute grant coordinates purpose/dataset/rule/engine/version access; **not cryptographic DRM over offline math**. Data fetch and grant check are bounded and do not trigger server backtest. Same data obtained through screener can be reused by a malicious client; this is a documented limit of the requirement.

Private scoring memakai feature vector dari client. Karena client dapat dimodifikasi,
hasil ini tidak menjadi bukti authoritative untuk billing atau kompetisi. Socket
ticket mempersempit akses/replay, bukan membuat browser terpercaya.

Browser installation UUID is pseudonymous registration, not hardware identity.
Browser web tidak dapat membaca MAC address secara aman dan portable. Server
menegakkan satu perangkat aktif dan cooldown perpindahan pada tingkat akun, bukan
mempercayai installation ID saja. IP from trusted proxy chain only; changes logged
as risk signal, not automatic hard-lock. Retention/privacy policy defined before
production.

## 6. Models and storage

Logical models (names proposed):

| Model | Minimum fields/invariant |
| --- | --- |
| user_profiles | user_id Supabase UUID PK, display fields, role=user/operator, status=active/suspended, version/timestamps |
| feature_grants | id, user_id, features allowlist, valid_from/until UTC, active/revoked, reason, actor, version |
| devices | id, user_id, installation_id, label, status, created/last_seen; unique user+installation |
| app_sessions | id, user_id/device_id, token_hash, expires_at, revoked_at; index active owner/device |
| rules | id, owner or explicit system marker, definition, schema/version/hash, timestamps |
| datasets | id/version/hash, provider/market/symbols/timeframe/currency/UTC/range/warmup/adjustment, quality |
| compute_grants | id, owner/session, purpose, dataset/rule hash/engine version, expiry/revocation |
| journal_transactions | id, owner, market/symbol/currency, BUY/SELL, quantity, price/fee, executed_at, note, version |
| audit_events | immutable actor/action/target/reason/UTC/request_id and sanitized before/after |

Schema disallows unknown owner as public. Decimal representation is explicit; financial journal values not binary floating point authority. Postgres foreign keys/indexes, transactions and migrations versioned. Dataset/reference shared only where provider rights permit; private rule/grant relations never shared implicitly.

Postgres protection is P1 gate. Keep database credentials server-only, constrain application role privileges, enable RLS, and test ownership both in the API and database. Verify backup/restore and migration rollback plan. Encryption does not replace owner filtering.

## 7. Historical data and efficiency

IDX/daily small universe first; Yahoo historical adapter as mentioned in memo subject to actual availability/licensing. Fixture used while provider decision pending; label demo clearly. Do not promise Yahoo realtime or any redistribution rights without verification.

Coalesce identical upstream fetches and use server cache/versioning; bounded timeout/retry/backoff and max symbols/range/candles/bytes. API limit initial matches FE: 100.000 aggregate candles and 50 MiB decoded, adjustable after profiling. Return explicit warmup and selected range; date bounds convention in contract.

Provider failure does not erase user journal. Respond safe stable errors, distinguish unavailable vs empty. Protected data/grants are private/no-store at CDN; only truly public versioned assets public cache. Compression HTTP/storage measured independently of encryption.

## 8. Journal and portfolio rules

P1 long-only, single currency IDR/IDX initially. Quantity sent in shares, not ambiguous lots; UI may convert lots explicitly using declared lot size. No short/margin/options/multi-currency accounting.

Working cost method: weighted average, fees BUY added to basis, fees SELL deducted from proceeds; final method confirmed M0 before financial tests. Ordered by executed_at plus deterministic tie-breaker. SELL above held quantity rejected. Backdated edit/delete recomputes all affected positions transactionally and rejects invalid resulting sells; no stale materialized P&L.

Money/quantity decimal strings, rounding policy explicit (IDR minor unit scale 0 for journal display, internal calculations retain declared precision). Same-day ordering and corporate actions unsupported require warnings; don't silently invent adjusted transaction quantities.

Draft signal never implies order execution. Server accepts confirmed fields as user journal entries, not verified broker fills. Portfolio valuation uses last available historical quote with source/time; missing quote means unknown unrealized value, not zero. Preserve realized P&L separately from valuation.

## 9. Migration and deployment

Keep backend/app and existing auth contracts as legacy. New /api/v1 Go slice gets contract tests before FE switch; compatibility adapter explicit. No dual-write, shared db mutation races or removing Python baseline prematurely. P0 legacy bridge is allowed and labeled; P1/MVP gate requires new Go slice implemented.

Migration tests empty DB and sanitized old fixture, backup/restore/rollback. Legacy rows without owner mapped only from verified provenance or archived; not assigned to first login. Profile upsert default user/active idempotent; cannot auto-promote.

Static FE hosting + Go API + Supabase Postgres. Readiness DB/migration/provider readiness separate from liveness. Reverse proxy/TLS/CORS allowlist, payload limits, rate limiting auth/grants/data, least privilege service identity, environment example with placeholders. Docker Go setup and database migration are verified separately.

## 10. Observability, evaluation and tests

Structured request IDs/stage timing, error counts, dataset bytes/cache hits, upstream rate, CPU/RAM and active sessions. last_seen/IP updates throttled. No passwords/bearer/session tokens, raw private rules/journal or secrets in logs. Client timings user-supplied, not trusted billing records.

Unit: core parity, schema/capabilities, principal/role/grants/expiry, dataset quality, weighted-average accounting, error sanitization. Integration: A/B every implemented private route, operator permissions, grant/revoke races, no-owner migrations, idempotent journal save, stale edits, encryption/recovery. Contract: OpenAPI examples and FE worker fixtures; legacy adapter compatibility. Security: forged role, enum/SQL/filter injection, token replay after revoke, over-limit payload, request direct without rights.

Benchmark 1/10/30 sessions equal workload, cold/warm, fetch/transfer/startup/compute split, server/client p50/p95 CPU/RAM/latency/traffic/failure. Profile actual low-end target before raising limits. No assumed Go speedup or fixed dollar saving.

## 11. Handoff, gates and DoD

M0: exact baseline path/strategy/formulas/fills, cost policy, normalized schema, limits/performance profile. M1: portable Go parity + versioned WASM. M2: P0 access/data + FE integration + benchmark. M3: P1 rule/provider/grants/devices/encryption. M4: journal/accounting. M5: end-to-end deployment/tests/evaluation.

Handoff FE: OpenAPI examples, stable errors, capabilities, nullable/enum rules, dataset and worker fixtures, WASM hash/runtime version, local user/grant seed procedure without production credentials. API unavailable means feature blocked/labeled mock, not invented call behavior.

P0 done: parity and screening/backtest client proof, protected fixture, ownership/entitlement, worker handoff, benchmark/threat model. P1 done: all P1 requirements implemented on Go slice, data rights/storage/device/journal validated, migrations/recovery/runbook, integration tests with FE real API and no high-severity security blocker. Realtime/payment/admin suite/installer are P2, not blockers.
