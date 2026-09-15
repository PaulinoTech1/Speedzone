import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const modern = createRequire(new URL('../node_modules/@vercel/python-analysis/package.json', import.meta.url)).resolve('minimatch');
const targets = [require.resolve('minimatch'), modern, path.resolve(path.dirname(modern), '../esm/index.js')];

describe.each(targets)('%s glob execution budget', target => {
  it('bounds adversarial globstars, shares budgets, and preserves normal matching', async () => {
    const timing = await new Promise<number>((resolve, reject) => {
      const worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        const assert = require('node:assert/strict');
        (async () => {
          const api = workerData.includes('/esm/') || workerData.includes('\\\\esm\\\\')
            ? await import(require('node:url').pathToFileURL(workerData).href) : require(workerData);
          const { Minimatch } = api;
          const input = Array(30).fill('a').join('/');
          const pattern = Array(11).fill('**/a').join('/') + '/b';
          const matcher = new Minimatch(pattern);
          const start = performance.now();
          assert.equal(matcher.match(input), false);
          const elapsed = performance.now() - start;
          assert.equal(new Minimatch(pattern + '/**').match(input), false);
          function limited(fn, maxBacktracks, expectedPath, expectedPattern) {
            let error;
            try { fn(); } catch (e) { error = e; }
            assert.ok(error);
            assert.equal(error.code, 'ERR_GLOB_BACKTRACK_LIMIT_EXCEEDED');
            assert.equal(error.message, 'Glob matching halted: exceeded maximum backtrack budget');
            assert.equal(error.maxBacktracks, maxBacktracks);
            assert.equal(error.backtrackCount, maxBacktracks + 1);
            assert.equal(error.path, expectedPath);
            assert.equal(error.pattern, expectedPattern);
          }
          const low = new Minimatch(pattern, {maxBacktracks: 1});
          limited(() => low.match(input), 1, input, pattern);
          limited(() => low.matchOne(input.split('/'), low.set[0], false), 1, input, pattern);
          low.options.maxBacktracks = 10000;
          assert.equal(low.match(input), false);
          // No budget/cache leakage across calls or brace-expanded alternatives.
          const repeated = new Minimatch('a', {maxBacktracks: 20});
          for (let i = 0; i < 100; i++) assert.equal(repeated.match('a'), true);
          const alternatives = '{' + Array.from({length: 100}, (_, i) => 'x' + i).join(',') + '}';
          limited(() => new Minimatch(alternatives, {maxBacktracks: 20}).match('a'), 20, 'a', alternatives);
          for (const value of [-1, Infinity, NaN, '10', 0.5]) {
            assert.throws(() => new Minimatch('a', {maxBacktracks: value}).match('a'));
          }
          const cases = [
            ['src/app/page.tsx', '**/*.tsx', {}, true],
            ['a/b/c', 'a/**/c', {}, true],
            ['a/.hidden/c', 'a/**/c', {}, false],
            ['a/.hidden/c', 'a/**/c', {dot:true}, true],
            ['a/../c', 'a/**/c', {dot:true, optimizationLevel:0}, false],
            ['a/b/', 'a/*', {}, true],
            ['a/b', 'a/b/c', {partial:true}, true],
            ['a/b.js', '*.{js,ts}', {matchBase:true}, true],
            ['a.js', '!*.ts', {}, true],
            ['a.js', '*.JS', {nocase:true}, true],
            ['a/a/b', '**/a/**/b', {}, true],
            ['a/a/c', '**/a/**/b', {}, false]
          ];
          for (const [file, glob, options, expected] of cases) assert.equal(new Minimatch(glob, options).match(file), expected, file + ' vs ' + glob);
          parentPort.postMessage(elapsed);
        })().catch(error => { throw error; });
      `, { eval: true, workerData: target });
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Glob evaluation exceeded worker deadline')); }, 5000);
      worker.once('message', value => { clearTimeout(timer); void worker.terminate(); resolve(value); });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
    });
    expect(timing).toBeLessThan(10);
  });
});
