import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve('smol-toml'));
type Result = { input: string; elapsed: number; code?: string; message?: string; line?: number; col?: number; isTomlError?: boolean; value?: unknown };
const comments = ['a=[1 #', 'a={ key = 1 #', 'a=[1, 2, # unclosed comment', 'a=[#', 'a={#', 'a=[true #', 'a=["ok" #', 'x=1\r\na={ key = 1 #', 'a=[1,\n # comment'];
const eof = ['a=[', 'a={', 'a=[1', 'a={key=1', 'a=[1,', 'a=[1 # comment\n', 'a={ key=1 # comment\n'];
const valid = ['a=[1, # comment\n2]', 'a={key=1, # comment\nother=2}', 'a=1 # valid EOF comment', '# valid EOF comment', 'a=["#"]', 'a=[[1], {k=2}]'];

describe.each(['commonjs', 'esm'])('%s TOML EOF guard', mode => {
  it('terminates malformed documents and preserves valid TOML', async () => {
    // A synchronous parser hang cannot be interrupted by a Vitest test timeout.
    // Isolate it in a worker with an independent termination deadline.
    const results = await new Promise<Result[]>((resolve, reject) => {
      const worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        (async () => {
          const api = workerData.mode === 'commonjs' ? require(workerData.cjs) : await import(workerData.esm);
          const results = workerData.inputs.map(input => {
            const start = performance.now();
            try { return { input, value: api.parse(input), elapsed: performance.now() - start }; }
            catch (error) { return { input, elapsed: performance.now() - start, code: error.code,
              message: error.message, line: error.line, col: error.col, isTomlError: error instanceof api.TomlError }; }
          });
          parentPort.postMessage(results);
        })().catch(error => { throw error; });
      `, { eval: true, workerData: { mode, cjs: path.join(dist, 'index.cjs'), esm: pathToFileURL(path.join(dist, 'index.js')).href, inputs: [...comments, ...eof, ...valid] } });
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('TOML parser exceeded worker deadline')); }, 3000);
      worker.once('message', results => { clearTimeout(timer); void worker.terminate(); resolve(results); });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
    });
    for (const result of results) {
      if (comments.includes(result.input)) {
        const prefix = result.input.slice(0, result.input.lastIndexOf('#')).split(/\r\n|\n|\r/);
        expect(result).toMatchObject({ code: 'ERR_TOML_UNTERMINATED_COMMENT', message: 'Unterminated comment at end of input',
          line: prefix.length, col: prefix.at(-1)!.length + 1, isTomlError: true });
        expect(result.elapsed, result.input).toBeLessThan(10);
      } else if (eof.includes(result.input)) {
        expect(result).toMatchObject({ code: 'ERR_TOML_UNEXPECTED_EOF', isTomlError: true });
      } else {
        expect(result.code).toBeUndefined();
        expect(result).toHaveProperty('value');
      }
    }
  });
});

it('throws the stall code when scanner progress is deliberately broken', () => {
  const { TomlError } = require('smol-toml');
  const util = readFileSync(path.join(dist, 'util.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/export /g, '')
    .replace('ctx.p++; continue;', 'continue;');
  expect(() => runInNewContext(util + '\nskipVoid({s:" ",p:0});', { TomlError }, { timeout: 1000 }))
    .toThrow(expect.objectContaining({ code: 'ERR_TOML_PARSER_STALL' }));
});
