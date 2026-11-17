# IDX whole-market screen profile (2026-11-17)

Baseline for speeding up a whole-market IDX screen (`purpose: "screen"`, the
market screen panel). Source: `fca84f8` plus the test-only harness on
`frontend/idx-screening-profile`.

## What was measured

`TestScreenRealCatalogTiming` (`backend/internal/api/tests/screen_real_catalog_timing_test.go`)
replays the screen flow of `runSignalStudy`: create scan, then for each batch of 10
it calls prepare, prefetches content and grant (4 at a time), computes features and
scores privately for each symbol in order, then releases the batch. It uses:

- the real HTTP routes (`/api/v1/screener/scans`, `/datasets/{id}/content`,
  `/compute-grants`, `/screener/signals`), with the cmd/api 60/min mutation limiter;
- `collection.NewRoutedStoreProvider` wrapped in `marketdata.NewCachedProvider(DefaultCacheOptions())`,
  as in `cmd/api/main.go`, with live routing pointed at a closed loopback port;
- a synthetic owner and session, plus a fake access store that grants `screener`;
- native Go `core.ComputeBacktestFeatures`, not the browser WASM Worker.
  IndexedDB storage is not exercised.

It is not a browser measurement. Browser feature (WASM) and IndexedDB costs per
symbol are still unmeasured here.

## Input pin

- Generation `generation-f2f57e423fb31a89744fd5b04d436bf9`, copied read-only into a
  private scratch store whose `current.json` names only that generation. The live
  store's `current.json` was never used.
- `report.json` sha256 `826411447c5f5ab04ad2bca7f7ab151cd2389acaf62a8714d61d2ba07d84574f`:
  882 success, 80 failed, 0 pending; window 2021-11-15..2026-11-15 (exclusive), +07:00.
- Catalog `catalog.json` (962 items) sha256 `dc45ab3fcf51737b77174c8b6cdefd2caeeb25e5d65dcbcfc9733462af1ea0fe`.
- Sorted per-file sha256 list of the generation, hashed: `2ced98f9052fe3243d5bc16023c42f9ec87386aaf92af1aeee2063d934d5d16d`.

Prices, catalog and outputs stay outside the repository.

## Environment and provenance

The results below come from two historical passes run by hand on 2026-11-17 (the
`out` and `out2` passes). Both used Docker context `orbstack` on arm64 and the Go
image pinned by digest `sha256:5cf287a7…`, with CGO off, `--network none`,
`--read-only`, user 65532, `--cpus 2 --memory 3g --pids-limit 256`,
`nofile=4096`, an in-container `timeout`, and the store, catalog and binary
mounted read-only. Variables reached the container only through explicit `-e`
flags. Those passes did not set `--cap-drop ALL` or `no-new-privileges`, did
not pin `--pull=never` or `--platform`, and wrote output and the Go build cache
to bind-mounted host scratch directories with no disk cap. The `out2` pass
also capped file size at 256 MB. Treat their control provenance as weaker than
the runner below. Rerunning the runner below reproduces them under full controls.

RTT is simulated by a client-side sleep before each request.

## Reproduce

```sh
SCREEN_STORE=<pinned store root> SCREEN_CATALOG=<catalog.json> SCREEN_OUT=<new dir outside the repo> \
SCREEN_REPORT_SHA256=826411447c5f5ab04ad2bca7f7ab151cd2389acaf62a8714d61d2ba07d84574f \
python3 -I backend/scripts/profile_screen_catalog.py
```

`profile_screen_catalog.py` gives the docker CLI only `PATH` and `HOME` and pins
the context, platform, image digest and `--pull=never`. Each container runs as
user 65532 with `--cap-drop ALL`, `no-new-privileges`, `--network none` and
`--read-only`. Source, module cache, archive, catalog and binary are mounted
read-only. The only writable path is a size-capped tmpfs at `/scratch`. Limits:
2 CPUs, 3 GB RAM and swap, 256 PIDs, 256 MB files, 4096 open files, plus a
wall-clock timeout inside and outside the container. Artifacts leave as a tar
on stdout, and the runner promotes only allowlisted regular files within byte
limits, never overwriting. `backend/scripts/test_profile_screen_catalog.py`
checks these controls and the promotion rules.

Each scenario writes `timing.json` (stages, per-route counts/statuses/bytes),
`oracle.json` (canonical outcome for every catalog member) and `cpu.pprof`.
`SIGNALGEN_SCREEN_SERVE=<duration>` serves the same fixture for a browser driver
(`Authorization: Bearer synthetic-<id>`, `X-App-Session: synthetic-session`;
`POST /api/v1/sessions` is not wired, so preseed the app session).

## Results

All runs covered 962 of 962 catalog members. Each failure keeps its code and is
never counted as a no-match.

| Scenario | Wall | Evaluated | Failed (code) | Signals | Oracle sha256 (prefix) |
|---|---|---|---|---|---|
| 1 day (2026-11-13), RTT 0, run 1 / 2 / 3 | 1.36 / 1.15 / 1.06 s | 881 | 81 (80 PROVIDER_UNAVAILABLE, 1 INSUFFICIENT_CANDLES) | 101 | `41c9792e` |
| 1 year (2025-11-14..2026-11-13), RTT 0, ×3 | 2.11 / 2.12 / 2.06 s | 871 | 91 (80 PROVIDER_UNAVAILABLE, 11 INSUFFICIENT_CANDLES) | 47,556 | `276d2162` |
| 1 day, RTT 20 ms | 31.8 s | 881 | 81 | 101 | `41c9792e` |
| 1 day, RTT 80 ms | 109.4 s | 881 | 81 | 101 | `41c9792e` |
| 1 year, RTT 80 ms | 112.4 s | 871 | 91 | 47,556 | `276d2162` |

For a one-day screen, 882 archive successes give 881 evaluated stocks; one
stock lacks indicator warmup inside the fetched range. The results matched across
repeated runs and on a second full runner pass.

Requests per one-day scan: 2,839 (1 create, 97 prepare, 881 content, 881 grant,
881 scoring, 97 release, 1 cancel). Scoring upload: 6.2 MB for one day, 38.8 MB
for one year.

Stage time at RTT 80 ms, one day (summed per stage; content and grant overlap):

| Stage | Seconds | On critical path |
|---|---|---|
| scoring (`/screener/signals`, one per symbol, awaited) | 74.0 | yes |
| wait for first prefetched symbol per batch | 16.4 | yes |
| prepare (97 batches) | 10.6 | yes |
| release (97 awaited DELETEs) | 8.1 | yes |
| content / grant (prefetch 4) | 73.9 / 73.6 | hidden except the first symbol |
| native features | 0.1 | yes, but negligible natively |

## Findings

1. The screen is bound by round trips. Server work is small: the whole-catalog
   prepare, including archive parse, takes about 0.8 s at RTT 0, and window size
   barely changes wall time (1.1 s vs 2.1 s at RTT 0, 109 s vs 112 s at RTT 80 ms).
2. The largest cost is 881 serial scoring requests: about 68% of wall time at
   80 ms RTT. Overlapping only WASM features with the in-flight scoring call
   cannot remove these round trips.
3. The next costs are per-batch: content then grant run sequentially before the
   first symbol of each batch, plus an awaited prepare and an awaited release for
   each of 97 batches (about 35 s at 80 ms).
4. The server limits use per dataset (one grant use and one signals use per study
   stock) and does not cap concurrency across symbols. Prepare for the next batch
   still requires the previous batch to be released.

## Not yet measured

- Browser Worker/WASM features and IndexedDB storage per symbol, cold and warm.
- Real network RTT; the RTT figures above are simulated.
- Any candidate change. Compare it against these oracles: identical per-symbol
  status, failure code and signal list for all 962 members.
