/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../node_modules/smol-toml/dist');
if (!fs.existsSync(root)) {
  if (!fs.existsSync(path.resolve(__dirname, '../node_modules/vercel'))) process.exit(0);
  throw new Error('Expected Vercel TOML dependency is missing.');
}
const ts = require('typescript');
const marker = '// SpeedZone TOML EOF and cursor guards v1';
const helpers = `
function speedzoneTomlError(ctx, code, message, ptr = ctx.p) {
  const error = new TomlError(message, { toml: ctx.s, ptr });
  return Object.assign(error, { code, message, col: error.column });
}
function speedzoneProgress(ctx, previous) {
  if (ctx.p <= previous && ctx.p < ctx.s.length) {
    throw speedzoneTomlError(ctx, 'ERR_TOML_PARSER_STALL', 'TOML parser cursor failed to advance');
  }
}
`;
const replacements = {
  skipComment: `function skipComment(ctx) {
    const start = ctx.p;
    for (; ctx.p < ctx.s.length; ctx.p++) {
      const c = ctx.s.charCodeAt(ctx.p);
      if (c === 10) return;
      if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10) { ctx.p++; return; }
      if ((c < 32 && c !== 9) || c === 127) {
        throw new TomlError('control characters are not allowed in comments', { toml: ctx.s, ptr: ctx.p });
      }
    }
    if (ctx.speedzoneDepth > 0) {
      throw speedzoneTomlError(ctx, 'ERR_TOML_UNTERMINATED_COMMENT', 'Unterminated comment at end of input', start);
    }
  }`,
  skipVoid: `function skipVoid(ctx, banNewLines, banComments) {
    let previous = -1;
    while (ctx.p < ctx.s.length) {
      speedzoneProgress(ctx, previous);
      previous = ctx.p;
      let c = ctx.s.charCodeAt(ctx.p);
      if (c === 32 || c === 9 || (!banNewLines && (c === 10 || (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)))) { ctx.p++; continue; }
      if (banComments || c !== 35) return;
      skipComment(ctx);
    }
  }`,
  skipUntil: `function skipUntil(ctx, sep, end) {
    if (!end) {
      const next = indexOfNewline(ctx.s, ctx.p);
      ctx.p = next < 0 ? ctx.s.length : next;
      return;
    }
    let previous = -1;
    while (ctx.p < ctx.s.length) {
      speedzoneProgress(ctx, previous);
      previous = ctx.p;
      const c = ctx.s.charCodeAt(ctx.p);
      if (c === 35) skipComment(ctx);
      else if (c === end || c === sep) return;
      if (ctx.p < ctx.s.length) ctx.p++;
    }
    throw speedzoneTomlError(ctx, 'ERR_TOML_UNEXPECTED_EOF', 'Unexpected end of input in open structure');
  }`,
};
for (const filename of ['util.js', 'struct.js', 'parse.js', 'index.cjs']) {
  const file = path.join(root, filename);
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(marker)) continue;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [];
  const found = new Set();
  for (const node of ast.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.name) continue;
    const name = node.name.text;
    let replacement;
    const exported = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ? 'export ' : '';
    if (replacements[name]) replacement = exported + replacements[name];
    else if (['parseArray', 'parseInlineTable', 'parse'].includes(name)) {
      let original = source.slice(node.getStart(ast), node.end);
      const loop = /while \(ctx\.p < (?:ctx\.s|toml)\.length\) \{/g;
      if ((original.match(loop) || []).length !== 1) throw new Error(`Unexpected TOML loop in ${name}`);
      original = original.replace(loop, match => `let speedzonePrevious = -1;\n${match}\nspeedzoneProgress(ctx, speedzonePrevious);\nspeedzonePrevious = ctx.p;`);
      if (name === 'parse') replacement = original;
      else {
        original = original.replace(`${exported}function ${name}(`, `function ${name}Internal(`);
        replacement = `${exported}function ${name}(ctx, integersAsBigInt) {
          ctx.speedzoneDepth = (ctx.speedzoneDepth || 0) + 1;
          try { return ${name}Internal(ctx, integersAsBigInt); }
          catch (error) {
            if (error instanceof TomlError && !error.code && ctx.p >= ctx.s.length) {
              throw speedzoneTomlError(ctx, 'ERR_TOML_UNEXPECTED_EOF', 'Unexpected end of input in open structure', ctx.s.length);
            }
            throw error;
          } finally { ctx.speedzoneDepth--; }
        }\n${original}`;
      }
    }
    if (replacement) { found.add(name); edits.push({ start: node.getStart(ast), end: node.end, replacement }); }
  }
  const expected = filename === 'util.js' ? 3 : filename === 'struct.js' ? 2 : filename === 'parse.js' ? 1 : 6;
  if (found.size !== expected) throw new Error(`TOML internals changed in ${filename}; review the patch.`);
  let output = source;
  for (const edit of edits.reverse()) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  fs.writeFileSync(file, output + '\n' + marker + '\n' + helpers);
}
const declaration = path.join(root, 'error.d.ts');
const types = fs.readFileSync(declaration, 'utf8');
if (!types.includes('ERR_TOML_UNTERMINATED_COMMENT')) {
  const classStart = 'export declare class TomlError extends Error {';
  if (!types.includes(classStart)) throw new Error('TOML error declarations changed; review the patch.');
  fs.writeFileSync(declaration, types.replace(classStart, classStart + `
    code?: 'ERR_TOML_UNTERMINATED_COMMENT' | 'ERR_TOML_UNEXPECTED_EOF' | 'ERR_TOML_PARSER_STALL';
    col?: number;`));
}
console.log('Applied TOML EOF and cursor guards (CommonJS and ESM).');
