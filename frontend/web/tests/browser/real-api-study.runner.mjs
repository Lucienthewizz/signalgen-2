import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScenario } from "./real-api-study.scenario.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = {
    dist: process.env.SIGNALGEN_DIST_DIR || (fs.existsSync("/dist") ? "/dist" : path.resolve(__dirname, "../../dist")),
    port: parseInt(process.env.SIGNALGEN_SERVE_PORT || "5174", 10),
    apiOrigin: process.env.SIGNALGEN_API_ORIGIN || "http://127.0.0.1:8080",
    outputDir: process.env.SIGNALGEN_OUTPUT_DIR || (fs.existsSync("/output") ? "/output" : path.resolve(__dirname, "../../output/playwright")),
  };

  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "--dist" && raw[i + 1]) args.dist = path.resolve(raw[++i]);
    else if (raw[i] === "--port" && raw[i + 1]) args.port = parseInt(raw[++i], 10);
    else if (raw[i] === "--api" && raw[i + 1]) args.apiOrigin = raw[++i];
    else if (raw[i] === "--output" && raw[i + 1]) args.outputDir = path.resolve(raw[++i]);
  }
  return args;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export function createServer(distDir, apiOrigin) {
  const parsedOrigin = new URL(apiOrigin);
  return http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, "http://127.0.0.1");
    const p = parsedUrl.pathname;

    // Proxy actual Go API routes
    if (p === "/api" || p.startsWith("/api/") || p === "/ready" || p === "/health") {
      const proxyReq = http.request(
        {
          hostname: parsedOrigin.hostname,
          port: parsedOrigin.port || (parsedOrigin.protocol === "https:" ? 443 : 80),
          path: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            host: `${parsedOrigin.hostname}:${parsedOrigin.port}`,
          },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on("error", (err) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "PROXY_ERROR", message: err.message } }));
      });
      req.pipe(proxyReq);
      return;
    }

    // Static files
    let cleanPath = p.replace(/^\/+/, "");
    if (!cleanPath) cleanPath = "index.html";
    const filePath = path.resolve(distDir, cleanPath);
    if (!filePath.startsWith(path.resolve(distDir))) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      fs.createReadStream(filePath).pipe(res);
    } else {
      const indexPath = path.join(distDir, "index.html");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      fs.createReadStream(indexPath).pipe(res);
    }
  });
}

async function main() {
  const { dist, port, apiOrigin, outputDir } = parseArgs();
  if (!fs.existsSync(dist)) {
    throw new Error(`Frontend distribution directory not found: ${dist}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const server = createServer(dist, apiOrigin);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const baseURL = `http://127.0.0.1:${port}`;
  console.error(`[Runner] Fixture server listening on ${baseURL}, proxying to ${apiOrigin}`);

  // Probe actual API readiness through the proxy
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(`${baseURL}/ready`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) {
    server.close();
    throw new Error(`API readiness probe failed on ${baseURL}/ready`);
  }

  // Import locked Playwright package
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();

    const result = await runScenario({
      page,
      baseURL,
      apiOrigin,
      screenshotDir: outputDir,
    });

    const reportPath = path.join(outputDir, "browser-real-api-result.json");
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));

    await context.close();
    await browser.close();
    server.close();
    process.exit(0);
  } catch (err) {
    console.error(`[Runner] Scenario execution error: ${err.stack || err.message}`);
    try {
      await browser.close();
    } catch {}
    server.close();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
