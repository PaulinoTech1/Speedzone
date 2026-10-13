// No secret values are emitted. Production must explicitly configure required
// controls; local and isolated Preview builds do not borrow Production secrets.
export function missingSecurityConfiguration(env) {
  const required = ["WEBAUTHN_ORIGIN", "WEBAUTHN_RP_ID", "BLOB_READ_WRITE_TOKEN", "TEST_DRIVE_BLOB_READ_WRITE_TOKEN", "TEST_DRIVE_ENCRYPTION_KEY",
    "ADMIN_RECOVERY_EMAIL", "RESEND_PASSWORD_RESET_API_KEY", "RESEND_EMAIL_DOMAIN", "BUG_REPORT_ORIGIN", "BUG_REPORT_ENCRYPTION_KEY", "BUG_REPORT_RATE_LIMIT_SECRET",
    "SECURITY_CONSOLE_TEST_SECRET", "SECURITY_TEST_TARGET_URL"];
  const missing = required.filter(key => !env[key]?.trim());
  const redisPair = env.KV_REST_API_URL ? ["KV_REST_API_URL", "KV_REST_API_TOKEN"] : ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
  missing.push(...redisPair.filter(key => !env[key]?.trim()));
  for (const key of ["TEST_DRIVE_ENCRYPTION_KEY", "BUG_REPORT_ENCRYPTION_KEY"]) {
    if (env[key] && !/^[A-Za-z0-9_-]{43}$/.test(env[key])) missing.push(`${key}: invalid key format`);
  }
  if (env.ADMIN_RECOVERY_EMAIL && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(env.ADMIN_RECOVERY_EMAIL)) missing.push("ADMIN_RECOVERY_EMAIL: invalid mailbox");
  for (const key of ["BUG_REPORT_RATE_LIMIT_SECRET", "SECURITY_CONSOLE_TEST_SECRET"]) {
    if (env[key] && env[key].length < 32) missing.push(`${key}: must contain at least 32 characters`);
  }
  for (const key of ["WEBAUTHN_ORIGIN", "BUG_REPORT_ORIGIN"]) {
    if (!env[key]) continue;
    try { const u = new URL(env[key]); if (u.protocol !== "https:" || u.origin !== env[key] || u.username || u.password) missing.push(`${key}: invalid origin`); }
    catch { missing.push(`${key}: invalid origin`); }
  }
  if (env.SECURITY_TEST_TARGET_URL) {
    try { const u = new URL(env.SECURITY_TEST_TARGET_URL); if (u.protocol !== "https:" || u.username || u.password) missing.push("SECURITY_TEST_TARGET_URL: invalid HTTPS target"); }
    catch { missing.push("SECURITY_TEST_TARGET_URL: invalid HTTPS target"); }
  }
  return missing;
}
if (process.env.VERCEL_ENV === "production") {
  const missing = missingSecurityConfiguration(process.env);
  if (missing.length) { console.error(`Production security configuration is incomplete: ${missing.join(", ")}`); process.exitCode = 1; }
}
