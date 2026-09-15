import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('js-yaml/package.json'));

describe.each(['commonjs', 'esm', 'browser', 'browser-min'])('%s YAML merge budget', mode => {
  it('bounds deep chains, counts all visits, and resets only between calls', async () => {
    const result = await new Promise<{ elapsed: number; count: number }>((resolve, reject) => {
      const worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        const assert = require('node:assert/strict');
        const path = require('node:path');
        const { pathToFileURL } = require('node:url');
        (async () => {
          let yaml;
          if (workerData.mode === 'commonjs') yaml = require(workerData.root);
          else if (workerData.mode === 'esm') yaml = await import(pathToFileURL(path.join(workerData.root, 'dist/js-yaml.mjs')).href);
          else {
            const sandbox = {};
            const name = workerData.mode === 'browser' ? 'js-yaml.js' : 'js-yaml.min.js';
            require('node:vm').runInNewContext(require('node:fs').readFileSync(path.join(workerData.root, 'dist', name), 'utf8'), sandbox);
            yaml = sandbox.jsyaml;
          }
          const small = 'base: &a {x: 1, y: 2}\\ncopy: {<<: *a, x: 3}';
          assert.equal(yaml.load(small, {maxMergedKeys: 2}).copy.x, 3);
          assert.equal(yaml.load(small, {maxMergedKeys: 2}).copy.y, 2);
          function breach(fn, limit, count) {
            let error;
            try { fn(); } catch (e) { error = e; }
            assert.ok(error instanceof yaml.YAMLException);
            assert.equal(error.code, 'ERR_YAML_MAX_MERGE_KEYS_EXCEEDED');
            assert.equal(error.message, 'Exceeded maximum allowed merged keys limit (maxMergedKeys)');
            assert.equal(error.maxMergedKeys, limit);
            assert.equal(error.mergedKeysCount, count);
            assert.ok(error.mark.line >= 0 && error.mark.position >= 0 && error.mark.column >= 0);
            return error;
          }
          breach(() => yaml.load(small, {maxMergedKeys: 1}), 1, 2);
          breach(() => yaml.load(small, {maxMergedKeys: 0}), 0, 1);
          // Existing destination keys and repeated aliases still cost visits.
          breach(() => yaml.load('a: &a {x: 1}\\nb: {x: 2, <<: [*a, *a]}', {maxMergedKeys: 1}), 1, 2);
          const multi = small + '\\n---\\n' + small;
          breach(() => yaml.loadAll(multi, {maxMergedKeys: 3}), 3, 4);
          breach(() => yaml.loadAll(multi, () => {}, {maxMergedKeys: 3}), 3, 4);
          assert.equal(yaml.loadAll(multi, {maxMergedKeys: 4}).length, 2);
          assert.equal(yaml.load(small, {maxMergedKeys: 2}).copy.y, 2);
          for (const maxMergedKeys of [-1, NaN, Infinity, 1.5, '2', null]) {
            assert.throws(() => yaml.load('a: 1', {maxMergedKeys}));
          }
          assert.equal(yaml.load('a: 1', {maxMergedKeys: 0}).a, 1);
          // Retain upstream limits on repeatedly merging empty mappings.
          assert.throws(() => yaml.load('a: &a {}\\nb: {<<: [' + Array(20002).fill('*a').join(',') + ']}'));
          const chain = ['a0: &a0 {k0: 0}'];
          for (let i = 1; i <= 4000; i++) chain.push('a' + i + ': &a' + i + ' {<<: *a' + (i-1) + ', k' + i + ': 1}');
          const input = chain.join('\\n');
          const start = performance.now();
          const error = breach(() => yaml.load(input), 10000, 10001);
          const elapsed = performance.now() - start;
          assert.ok(error.mark.line < 200, 'must stop near the budget, not after parsing the full chain');
          parentPort.postMessage({elapsed, count: error.mergedKeysCount});
        })().catch(error => { throw error; });
      `, { eval: true, workerData: { mode, root } });
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('YAML parser exceeded worker deadline')); }, 5000);
      worker.once('message', result => { clearTimeout(timer); void worker.terminate(); resolve(result); });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
    });
    expect(result.count).toBe(10001);
    expect(result.elapsed).toBeLessThan(20);
  });
});
