import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

export function staticAssets(manifest, entry) {
  const visited = new Set(),
    files = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) throw Error(`Missing manifest entry: ${key}`);
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  }
  visit(entry);
  return [...files];
}
export function assertBudgets(metrics, limits, names) {
  for (const name of names) {
    if (
      !Number.isFinite(metrics[name]) ||
      !Number.isFinite(limits[name]) ||
      metrics[name] > limits[name]
    )
      throw Error(
        `Performance budget exceeded: ${name}=${metrics[name]}, maximum=${limits[name]}`,
      );
  }
}
export function measureBuild(dist) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dist, ".vite/manifest.json"), "utf8"),
  );
  const workspace = Object.keys(manifest).find(
    (key) => manifest[key].name === "demo-workspace",
  );
  const journal = manifest["src/pages/workspace-journal-panel.tsx"];
  if (!workspace || !journal?.isDynamicEntry)
    throw Error("Journal must remain a lazy route");
  const entryFiles = staticAssets(manifest, "index.html");
  const workspaceFiles = staticAssets(manifest, workspace);
  if (workspaceFiles.includes(journal.file))
    throw Error("Journal leaked into the static workspace bundle");
  const size = (files, extension) =>
    files
      .filter((file) => file.endsWith(extension))
      .reduce(
        (sum, file) =>
          sum + gzipSync(fs.readFileSync(path.join(dist, file))).length,
        0,
      );
  return {
    entryJsGzipBytes: size(entryFiles, ".js"),
    workspaceStaticJsGzipBytes: size(workspaceFiles, ".js"),
    entryCssGzipBytes: size(entryFiles, ".css"),
    entryFiles,
    workspaceFiles,
    journalFile: journal.file,
  };
}
export function checkLab(report, limits) {
  if (!report.scenario?.startsWith("mobile emulation"))
    throw Error("Expected a mobile lab report, not desktop/field data");
  const m = report.labMetrics;
  if (
    !m?.supported?.includes("largest-contentful-paint") ||
    !m.supported.includes("layout-shift") ||
    !m.supported.includes("event") ||
    report.scriptedInteractions < 8 ||
    !(m.lcpMs > 0)
  )
    throw Error("Incomplete lab observations");
  assertBudgets({ mobileLcpMs: m.lcpMs, mobileCls: m.cls }, limits, [
    "mobileLcpMs",
    "mobileCls",
  ]);
  if (m.interactionLatencyMsMax !== null)
    assertBudgets(
      { mobileObservedInteractionMs: m.interactionLatencyMsMax },
      limits,
      ["mobileObservedInteractionMs"],
    );
  else
    console.warn(
      "No interaction >=16ms observed; this is not a measured zero or production INP.",
    );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const limits = JSON.parse(
    fs.readFileSync(path.join(root, "performance-budgets.json"), "utf8"),
  );
  const metrics = measureBuild(path.join(root, "dist"));
  assertBudgets(metrics, limits, [
    "entryJsGzipBytes",
    "workspaceStaticJsGzipBytes",
    "entryCssGzipBytes",
  ]);
  if (process.argv.includes("--lab"))
    checkLab(
      JSON.parse(
        fs.readFileSync(
          path.join(root, "output/playwright/loading-mobile-after.json"),
          "utf8",
        ),
      ),
      limits,
    );
  fs.mkdirSync(path.join(root, "output/playwright"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "output/playwright/bundle-budget.json"),
    JSON.stringify({ metrics, limits }, null, 2),
  );
  console.log("PASS: performance budgets", JSON.stringify(metrics));
}
