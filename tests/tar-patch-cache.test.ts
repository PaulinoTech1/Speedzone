import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("speedzone-tar-cache-")) throw new Error("Unexpected fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});

it.each(["\r\n", "\n"])("recognizes a cached tar patch after checkout line endings change from %j", (initialEnding) => {
  const root = mkdtempSync(path.join(tmpdir(), "speedzone-tar-cache-"));
  roots.push(root);
  const scripts = path.join(root, "scripts");
  const tar = path.join(root, "node_modules/tar");
  mkdirSync(scripts, { recursive: true });
  const patch = path.join(scripts, "patch-tar.cjs");
  writeFileSync(patch, readFileSync("scripts/patch-tar.cjs"));
  const boundary = readFileSync("scripts/tar-boundary.cjs", "utf8").replace(/\r\n/g, "\n");
  writeFileSync(path.join(scripts, "tar-boundary.cjs"), boundary.replace(/\n/g, initialEnding));
  for (const build of ["commonjs", "esm"]) {
    mkdirSync(path.join(tar, "dist", build), { recursive: true });
    writeFileSync(path.join(tar, "dist", build, "unpack.js"), "class Unpack {\n    [CHECKPATH](entry) {\n        return true;\n    }\n}\n");
  }
  writeFileSync(path.join(tar, "package.json"), JSON.stringify({ exports: { ".": {
    import: { default: "./dist/esm/index.min.js" }, require: { default: "./dist/commonjs/index.min.js" },
  } } }));
  execFileSync(process.execPath, [patch]);
  // Recreate a cache written by the older patcher, which preserved checkout EOLs.
  for (const build of ["commonjs", "esm"]) {
    const file = path.join(tar, "dist", build, "unpack.js");
    writeFileSync(file, readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n/g, initialEnding));
  }
  writeFileSync(path.join(scripts, "tar-boundary.cjs"), boundary.replace(/\n/g, initialEnding === "\n" ? "\r\n" : "\n"));
  expect(() => execFileSync(process.execPath, [patch], { stdio: "pipe" })).not.toThrow();
  for (const build of ["commonjs", "esm"]) {
    const file = path.join(tar, "dist", build, "unpack.js");
    const contents = readFileSync(file, "utf8");
    expect(contents.match(/SpeedZone extraction boundary guard/g)).toHaveLength(1);
    // A genuinely different guard must still fail closed.
    writeFileSync(file, contents.replace("Extraction path or link target", "Altered boundary"));
    expect(() => execFileSync(process.execPath, [patch], { stdio: "pipe" })).toThrow();
    writeFileSync(file, contents);
  }
});
