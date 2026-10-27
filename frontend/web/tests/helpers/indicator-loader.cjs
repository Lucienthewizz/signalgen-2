const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
function load(name = 'indicators') {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../../src/lib', name + '.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022} }).outputText,
    {exports, require: name => load(name.replace('./', ''))});
  return exports;
}
module.exports = load();
