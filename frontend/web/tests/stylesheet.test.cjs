const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const postcss = require("postcss");

const src = path.join(__dirname, "../src");
const modules = [
  "resource-quota",
  "foundation-shell",
  "landing-base",
  "auth-workspace-base",
  "workspace-surfaces",
  "news-journal-details",
  "workspace-compatibility",
];

test("stylesheet entry keeps explicit cascade order and imports each module once", () => {
  const root = postcss.parse(fs.readFileSync(path.join(src, "styles.css"), "utf8"));
  assert.ok(root.nodes.every(node => node.type === "atrule" && node.name === "import"));
  assert.deepEqual(root.nodes.map(node => node.params), [
    '"tailwindcss"',
    ...modules.map(name => `"./styles/${name}.css"`),
  ]);
});

test("stylesheet modules parse independently and do not introduce hidden imports", () => {
  for (const name of modules) {
    const root = postcss.parse(fs.readFileSync(path.join(src, "styles", name + ".css"), "utf8"));
    assert.ok(root.nodes.length > 0, `${name} must not be empty`);
    root.walkAtRules("import", () => assert.fail(`Nested import in ${name}`));
    root.walkDecls(decl => {
      for (const [, url] of decl.value.matchAll(/url\(\s*["']?([^)'"\s]+)/g))
        assert.ok(url.startsWith("#") || url.startsWith("data:") || url.startsWith("https:"), `Rebase relative URL in ${name}: ${url}`);
    });
  }
});
