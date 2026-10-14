async (page) => {
  await page.goto("http://127.0.0.1:5174/#home");
  const report = await page.evaluate(async () => {
    const symbols = ["BBCA.JK", "BBRI.JK", "TLKM.JK"];
    const series = symbols.map(symbol => ({ symbol, timezone: "UTC", candles: Array.from({ length: 100 }, (_, i) => ({ timestamp: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), open: 100 + i, high: 103 + i, low: 99 + i, close: 102 + i, volume: 1000 + i })) }));
    const NativeWorker = window.Worker;
    let constructions = 0;
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); constructions++; } };
    const engine = await import("/src/analysis/screener-engine.ts");
    engine.disposeScreenerEngine();
    try {
      const baselineStart = performance.now();
      const baseline = await Promise.all(series.map(item => new Promise((resolve, reject) => {
        const worker = new Worker("/src/workers/screener.worker.ts", { type: "module" });
        const timeout = setTimeout(() => { worker.terminate(); reject(Error("Baseline worker timeout")); }, 45000);
        worker.onerror = () => { clearTimeout(timeout); worker.terminate(); reject(Error("Baseline worker failed")); };
        worker.onmessage = event => { clearTimeout(timeout); worker.terminate(); if (event.data.type === "error") reject(Error(event.data.message)); else resolve(event.data.features); };
        worker.postMessage({ type: "extract", jobId: item.symbol, symbol: item.symbol, candles: item.candles });
      })));
      const baselineMs = performance.now() - baselineStart;
      const baselineWorkers = constructions;
      const batchStart = performance.now();
      const first = await engine.extractDatasetFeatures(series, new AbortController().signal);
      const batchMs = performance.now() - batchStart;
      const batchWorkers = constructions - baselineWorkers;
      const warmStart = performance.now();
      const second = await engine.extractDatasetFeatures(series, new AbortController().signal);
      const warmMs = performance.now() - warmStart;
      if (JSON.stringify(baseline) !== JSON.stringify(first) || JSON.stringify(first) !== JSON.stringify(second)) throw Error("Batch changed real Go/WASM indicator results");
      if (baselineWorkers !== 3 || batchWorkers !== 1 || constructions !== 4) throw Error("Worker was not reused");
      return { stocks: series.length, candles_per_stock: 100, candidates: first.reduce((sum, item) => sum + item.candidates.length, 0), baseline_workers: baselineWorkers, batch_workers: batchWorkers, warm_new_workers: constructions - baselineWorkers - batchWorkers, baseline_ms: +baselineMs.toFixed(2), batch_ms: +batchMs.toFixed(2), warm_ms: +warmMs.toFixed(2), identical_results: true };
    } finally { engine.disposeScreenerEngine(); window.Worker = NativeWorker; }
  });
  console.log("SIGNALGEN_ENGINE_BENCHMARK=" + JSON.stringify(report));
  await page.evaluate(report => { document.body.textContent = JSON.stringify(report, null, 2); }, report);
  await page.screenshot({ path: "/private/tmp/signalgen-engine-benchmark.png", timeout: 5000 });
}
