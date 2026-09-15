/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const workspace = path.resolve(__dirname, '..');
const packages = [];
function discover(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const location = path.join(directory, entry.name);
    if (entry.name.startsWith('@')) { discover(location); continue; }
    if (entry.name === 'minimatch') packages.push(location);
    discover(path.join(location, 'node_modules'));
  }
}
discover(path.join(workspace, 'node_modules'));
if (!packages.length) process.exit(0);
const ts = require('typescript');
const marker = '// SpeedZone glob memoization and step budget v1';
const helpers = `
const speedzoneGlobContexts = new WeakMap();
function speedzoneGlobContext(instance, input) {
  const maxBacktracks = instance.options.maxBacktracks === undefined ? 10000 : instance.options.maxBacktracks;
  if (!Number.isSafeInteger(maxBacktracks) || maxBacktracks < 0) throw new TypeError('maxBacktracks must be a non-negative safe integer');
  return { maxBacktracks, backtrackCount: 0, pattern: instance.pattern, path: input, failures: new WeakMap() };
}
function speedzoneGlobStep(instance) {
  const context = speedzoneGlobContexts.get(instance);
  if (++context.backtrackCount > context.maxBacktracks) {
    throw Object.assign(new Error('Glob matching halted: exceeded maximum backtrack budget'), {
      code: 'ERR_GLOB_BACKTRACK_LIMIT_EXCEEDED', pattern: context.pattern, path: context.path,
      backtrackCount: context.backtrackCount, maxBacktracks: context.maxBacktracks
    });
  }
}
`;
for (const root of packages) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const major = Number(version.split('.')[0]);
  if (![3, 10].includes(major)) throw new Error(`Review glob guard for minimatch ${version}`);
  const files = major === 3 ? ['minimatch.js'] : ['dist/commonjs/index.js', 'dist/esm/index.js'];
  for (const filename of files) {
    const file = path.join(root, filename);
    const source = fs.readFileSync(file, 'utf8');
    if (source.includes(marker)) continue;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const edits = [];
    function visit(node) {
      let name;
      if (ts.isMethodDeclaration(node)) name = node.name.getText(ast).replace(/^#/, '_');
      else if (ts.isFunctionExpression(node) && ts.isBinaryExpression(node.parent)) {
        const target = node.parent.left.getText(ast);
        if (target.startsWith('Minimatch.prototype.')) name = target.slice('Minimatch.prototype.'.length);
      }
      if (['match', 'matchOne', '_matchOne', '_matchGlobstar', '_matchGlobStarBodySections'].includes(name) && node.body) {
        const start = node.body.getStart(ast) + 1;
        const end = node.body.end - 1;
        let body = source.slice(start, end);
        const loops = [];
        function findLoops(child) {
          if (ts.isForStatement(child) || ts.isWhileStatement(child) || ts.isForOfStatement(child)) {
            if (!ts.isBlock(child.statement)) throw new Error('Glob loop layout changed; review guard.');
            loops.push(child.statement.getStart(ast) + 1 - start);
          }
          ts.forEachChild(child, findLoops);
        }
        findLoops(node.body);
        for (const offset of loops.sort((a, b) => b - a)) body = body.slice(0, offset) + '\nspeedzoneGlobStep(this);\n' + body.slice(offset);
        body = '\nspeedzoneGlobStep(this);\n' + body;
        if (name === '_matchGlobStarBodySections') {
          body = `
            const context = speedzoneGlobContexts.get(this);
            let failures = context.failures.get(bodySegments);
            if (!failures) context.failures.set(bodySegments, failures = new Map());
            const key = fileIndex + ':' + bodyIndex;
            if (failures.has(key)) return failures.get(key);
            const result = (() => { ${body} })();
            if (!result) failures.set(key, result);
            return result;
          `;
        }
        if (name === 'match' || name === 'matchOne') {
          const input = name === 'match' ? 'f' : "file.join('/')";
          body = `
            const previous = speedzoneGlobContexts.get(this);
            const ownsContext = ${name === 'match' ? 'true' : '!previous'};
            if (ownsContext) speedzoneGlobContexts.set(this, speedzoneGlobContext(this, ${input}));
            try { ${body} }
            finally {
              if (ownsContext) {
                if (previous) speedzoneGlobContexts.set(this, previous);
                else speedzoneGlobContexts.delete(this);
              }
            }
          `;
        }
        edits.push({ start, end, body });
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    if (edits.length !== 5) throw new Error(`Glob matcher internals changed in ${file}; review guard.`);
    let output = source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.body + output.slice(edit.end);
    fs.writeFileSync(file, output + '\n' + marker + '\n' + helpers);
  }
  if (major === 10) {
    for (const build of ['commonjs', 'esm']) {
      const file = path.join(root, 'dist', build, 'index.d.ts');
      const types = fs.readFileSync(file, 'utf8');
      if (!types.includes('maxBacktracks?: number')) {
        if (!types.includes('export interface MinimatchOptions {')) throw new Error('Glob option declarations changed.');
        fs.writeFileSync(file, types.replace('export interface MinimatchOptions {', 'export interface MinimatchOptions {\n    maxBacktracks?: number;'));
      }
    }
  }
}
console.log('Applied glob memoization and backtracking budget to ' + packages.length + ' minimatch installations.');
