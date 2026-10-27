import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir,cpus,totalmem,platform,arch} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cli=process.env.SIGNALGEN_TEST_PLAYWRIGHT_CLI || 'playwright-cli';
const origin=process.env.SIGNALGEN_TEST_BASE_URL || 'http://127.0.0.1:5174';
const folder=mkdtempSync(path.join(tmpdir(),'signalgen-indicator-bench-'));
const config=path.join(folder,'config.json');
writeFileSync(config,JSON.stringify({browser:{browserName:'chromium',launchOptions:{headless:true,...(process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE?{executablePath:process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE}:{})},contextOptions:{viewport:{width:1440,height:1000}}}}));
const cases=JSON.parse(readFileSync(path.join(root,'../../backend/core/testdata/indicator_benchmark_cases.json'),'utf8'));
const source=readFileSync(path.join(root,'tests/browser/indicators-benchmark.cli.js'),'utf8').trim();
const job=path.join(folder,'run.js');
writeFileSync(job,`async (page) => { return await (${source})(page,${JSON.stringify(cases)}); }`);
const name=`indicator-bench-${process.pid}`;
function run(args) {
  const output=execFileSync(cli,[`-s=${name}`,...args],{cwd:root,encoding:'utf8',timeout:300000,maxBuffer:4<<20});
  if(output.includes('### Error')) throw Error(output);
  return output;
}
try {
  run(['open',origin,'--config',config]);
  run(['snapshot']);
  run(['run-code','--filename',job]);
  const text=run(['eval','() => JSON.parse(document.body.dataset.indicatorBenchmark)']);
  const match=text.match(/### Result\s+([\s\S]*?)(?:\n### |$)/);
  if(!match) throw Error('Benchmark output missing');
  const report={...JSON.parse(match[1]),machine:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logical_cpus:cpus().length,memory_bytes:totalmem()}};
  const output=path.join(root,'output/playwright/indicators-benchmark.json');
  mkdirSync(path.dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(`First screener call: ${report.first_screener_call_ms.toFixed(2)} ms`);
  console.log(`Fresh worker loader: median ${report.loader.median_ms.toFixed(2)} ms, p95 ${report.loader.p95_ms.toFixed(2)} ms`);
  for(const row of report.cases) console.log(`${row.id}: median ${row.median_ms.toFixed(2)} ms; p95 ${row.p95_ms.toFixed(2)} ms (${row.samples} samples, ${row.worker_policy})`);
  console.log(`Raw report: ${output}`);
} finally {try {run(['close'])} catch {}}
