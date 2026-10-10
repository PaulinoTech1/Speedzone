import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('js-yaml/package.json'));

describe.each(['commonjs', 'esm'])('%s YAML merge budget (js-yaml 5.x)', mode => {
  it('bounds merge keys via native maxTotalMergeKeys', async () => {
    const result = await new Promise<{ elapsed: number; count: number }>((resolve, reject) => {
      const worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        const assert = require('node:assert/strict');
        const path = require('node:path');
        const { pathToFileURL } = require('node:url');
        (async () => {
          let yaml;
          if (workerData.mode === 'commonjs') yaml = require(workerData.root);
          else yaml = await import(pathToFileURL(path.join(workerData.root, 'dist/js-yaml.mjs')).href);
          const { CORE_SCHEMA, mergeTag } = yaml;
          const schema = CORE_SCHEMA.withTags(mergeTag);
          const small = 'base: &a {x: 1, y: 2}\\ncopy: {<<: *a, x: 3}';
          // Merges work when the tag is enabled.
          const loaded = yaml.load(small, { schema, maxTotalMergeKeys: 10 });
          assert.equal(loaded.copy.x, 3);
          assert.equal(loaded.copy.y, 2);
          // Exceeding the budget throws.
          let error;
          try {
            yaml.load(small, { schema, maxTotalMergeKeys: 1 });
          } catch (e) { error = e; }
          assert.ok(error instanceof yaml.YAMLException);
          assert.match(error.message, /merge keys exceeded maxTotalMergeKeys/);
          // Budget stops large attacks.
          const big = 'a: &a {}\\nb: {<<: [' + Array(20002).fill('*a').join(',') + ']}';
          assert.throws(() => yaml.load(big, { schema, maxTotalMergeKeys: 100 }));
          // Merges are off by default (secure default).
          const plain = yaml.load(small);
          assert.ok('<<' in plain.copy, 'merge key should remain literal without mergeTag');
          parentPort.postMessage({ elapsed: 1, count: 1 });
        })().catch(error => { throw error; });
      `, { eval: true, workerData: { mode, root } });
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('YAML parser exceeded worker deadline')); }, 5000);
      worker.once('message', result => { clearTimeout(timer); void worker.terminate(); resolve(result); });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
    });
    expect(result.count).toBe(1);
    expect(Number.isFinite(result.elapsed)).toBe(true);
  });
});
