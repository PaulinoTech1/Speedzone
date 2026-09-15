// Read the installed package directly so this guard works on Windows and Linux
// without depending on a shell or npm's output format.
const { readFileSync } = process.getBuiltinModule("node:fs");
const { resolve } = process.getBuiltinModule("node:path");
const MIN_VERCEL_MAJOR = 59;
const ERROR_CODE = "ERR_DEP_DOWNGRADE_DETECTED";

try {
  const { version } = JSON.parse(readFileSync(resolve(__dirname, "../node_modules/vercel/package.json"), "utf8"));
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) {
    throw new Error("Vercel dependency has a missing or invalid version.");
  }
  if (Number(version.split(".")[0]) < MIN_VERCEL_MAJOR) {
    throw new Error(`Detected version downgrade: vercel@${version} is below expected major version ${MIN_VERCEL_MAJOR}.`);
  }
  console.log(`[OK] Dependency check passed: vercel@${version}`);
} catch (error) {
  console.error(`[${ERROR_CODE}] ${error.message}`);
  process.exitCode = 101;
}
