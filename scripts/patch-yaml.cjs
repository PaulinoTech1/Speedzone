/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../node_modules/js-yaml');
if (!fs.existsSync(root)) {
  if (!fs.existsSync(path.resolve(__dirname, '../node_modules/vercel'))) process.exit(0);
  throw new Error('Expected YAML dependency is missing.');
}
const ts = require('typescript');
const marker = '// SpeedZone YAML cumulative merge budget v1';
const counter = `
    state.mergedKeysCount += 1;
    if (state.mergedKeysCount > state.maxMergedKeys) {
      const message = 'Exceeded maximum allowed merged keys limit (maxMergedKeys)';
      const error = generateError(state, message);
      throw Object.assign(error, {
        code: 'ERR_YAML_MAX_MERGE_KEYS_EXCEEDED', message,
        maxMergedKeys: state.maxMergedKeys, mergedKeysCount: state.mergedKeysCount
      });
    }
`;
for (const name of ['lib/loader.js', 'dist/js-yaml.mjs', 'dist/js-yaml.js']) {
  const file = path.join(root, name);
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(marker)) continue;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && (node.name?.text === 'mergeMappings' || (node.name?.text === 'State' && node.parameters.length === 2))) {
      let replacement = source.slice(node.getStart(ast), node.end);
      if (node.name.text === 'State') {
        const start = replacement.indexOf('{') + 1;
        replacement = replacement.slice(0, start) + `
          this.maxMergedKeys = options.maxMergedKeys === undefined ? 10000 : options.maxMergedKeys;
          if (!Number.isSafeInteger(this.maxMergedKeys) || this.maxMergedKeys < 0) {
            throw new TypeError('maxMergedKeys must be a non-negative safe integer');
          }
          this.mergedKeysCount = 0;
        ` + replacement.slice(start);
        // Keep the upstream work budget (including empty source visits), but
        // reserve enough headroom for the exact key-only limit to fire first.
        const budget = /(this\.maxTotalMergeKeys\s*=[^\n]+:\s*)(?:10000|1e4)/;
        if (!budget.test(replacement)) throw new Error('YAML work budget changed; review patch.');
        replacement = replacement.replace(budget, '$1(this.maxMergedKeys + 10000)');
      } else {
        const calls = [...replacement.matchAll(/chargeMergeWork\(state\)/g)];
        if (calls.length !== 2) throw new Error('YAML merge traversal changed; review patch.');
        const offset = calls[1].index;
        replacement = replacement.slice(0, offset) + counter + replacement.slice(offset);
      }
      edits.push({ start: node.getStart(ast), end: node.end, replacement });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (edits.length !== 2) throw new Error(`YAML internals changed in ${name}; review patch.`);
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  fs.writeFileSync(file, output + '\n' + marker + '\n');
}
// Keep the browser distribution protected as well; preserve its UMD interface.
fs.copyFileSync(path.join(root, 'dist/js-yaml.js'), path.join(root, 'dist/js-yaml.min.js'));
console.log('Applied YAML cumulative merge budget (CommonJS, ESM, and browser builds).');
