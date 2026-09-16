/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const validate = require('./tar-boundary.cjs');
const root = path.resolve(__dirname, '../node_modules/tar');
if (!fs.existsSync(root)) {
  // tar belongs to the development-only Vercel CLI.
  if (!fs.existsSync(path.resolve(__dirname, '../node_modules/vercel'))) process.exit(0);
  throw new Error('Expected Vercel tar dependency is missing.');
}
const marker = '    [CHECKPATH](entry) {\n';
// A cached patch can originate from a Windows checkout or a Linux Git build.
// Normalize only line endings; substantive guard changes must still fail closed.
const validatorSource = validate.toString().replace(/\r\n/g, '\n');
for (const build of ['commonjs', 'esm']) {
  const file = path.join(root, 'dist', build, 'unpack.js');
  const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const pathName = build === 'esm' ? 'path' : 'node_path_1.default';
  const guard = `${marker}        // SpeedZone extraction boundary guard\n        try {\n            (${validatorSource})(entry, this.cwd, ${pathName});\n        } catch (error) {\n            this.emit('error', error);\n            return false;\n        }\n`;
  if (source.includes(guard)) continue;
  if (source.includes('SpeedZone extraction boundary guard') || source.split(marker).length !== 2) {
    throw new Error('tar internals changed; review the extraction boundary patch before installing.');
  }
  fs.writeFileSync(file, source.replace(marker, guard));
}
console.log('Applied tar extraction boundary guard (CommonJS and ESM).');
// The default exports use prebundled copies; route them through the patched
// unbundled builds, which tar also publishes as its ./raw entry point.
const manifestPath = path.join(root, 'package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const [mode, build] of [['import', 'esm'], ['require', 'commonjs']]) {
  const entry = manifest.exports['.'][mode];
  if (![ `./dist/${build}/index.min.js`, `./dist/${build}/index.js` ].includes(entry.default)) {
    throw new Error('tar exports changed; review the extraction boundary patch.');
  }
  entry.default = `./dist/${build}/index.js`;
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
