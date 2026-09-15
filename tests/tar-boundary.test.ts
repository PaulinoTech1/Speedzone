import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as esmTar from 'tar';

const require = createRequire(import.meta.url);
const cjsTar: typeof esmTar = require('tar');
const validate = require('../scripts/tar-boundary.cjs');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

for (const [build, tar] of [['esm', esmTar], ['commonjs', cjsTar]] as const) {
  for (const sync of [false, true]) {
    describe(`${build} Unpack sync=${sync}`, () => {
      for (const type of ['File', 'Link', 'SymbolicLink'] as const) {
        for (const escape of ['C:../target.txt', 'D:..\\..\\out.txt', '\\\\?\\C:../target.txt', '/../../target.txt', '../root-sibling/target.txt']) {
          it(`rejects ${type} ${escape}`, async () => {
            const root = mkdtempSync(path.join(tmpdir(), 'speedzone-tar-'));
            roots.push(root);
            const cwd = path.join(root, 'root');
            mkdirSync(cwd);
            writeFileSync(path.join(root, 'target.txt'), 'unchanged');
            const header = new tar.Header({ path: type === 'File' ? escape : 'entry', type,
              linkpath: type === 'File' ? '' : escape, size: 0 });
            const block = Buffer.alloc(512);
            header.encode(block);
            const unpack = sync ? new tar.UnpackSync({ cwd }) : new tar.Unpack({ cwd });
            const errors: Error[] = [];
            unpack.on('error', error => errors.push(error));
            unpack.end(Buffer.concat([block, Buffer.alloc(1024)]));
            await new Promise(resolve => setImmediate(resolve));
            expect(errors).toHaveLength(1);
            expect(errors[0]).toMatchObject({ code: 'ERR_TAR_PATH_TRAVERSAL',
              message: 'Extraction path or link target attempts to escape target directory', entryPath: escape, targetCwd: cwd.replaceAll('\\', '/') });
            expect(readdirSync(cwd)).toEqual([]);
            expect(readFileSync(path.join(root, 'target.txt'), 'utf8')).toBe('unchanged');
          });
        }
      }
      it('extracts a safe file', async () => {
        const cwd = mkdtempSync(path.join(tmpdir(), 'speedzone-tar-'));
        roots.push(cwd);
        const block = Buffer.alloc(512);
        new tar.Header({ path: 'safe.txt', type: 'File', size: 0 }).encode(block);
        const unpack = sync ? new tar.UnpackSync({ cwd }) : new tar.Unpack({ cwd });
        await new Promise<void>((resolve, reject) => {
          unpack.on('error', reject);
          unpack.on('close', resolve);
          unpack.end(Buffer.concat([block, Buffer.alloc(1024)]));
        });
        expect(readdirSync(cwd)).toEqual(['safe.txt']);
      });
    });
  }
}

it('enforces boundaries with both Windows and POSIX path semantics', () => {
  for (const [api, cwd] of [[path.win32, 'C:\\extract'], [path.posix, '/extract']] as const) {
    expect(() => validate({ path: 'entry', type: 'Link', linkpath: 'D:..\\..\\out.txt' }, cwd, api)).toThrow(expect.objectContaining({ code: 'ERR_TAR_PATH_TRAVERSAL' }));
    const entry = { path: 'C:/folder/file.txt', type: 'File' };
    validate(entry, cwd, api);
    expect(entry.path).toBe('folder/file.txt');
  }
});
