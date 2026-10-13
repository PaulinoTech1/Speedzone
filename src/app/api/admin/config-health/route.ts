import { isAdmin, privateResponseHeaders } from "@/lib/admin-auth";
import { recoveryConfigured } from "@/lib/admin-recovery";
import { getRedis } from "@/lib/redis";
import { inventoryStateKey } from "@/lib/inventory-state";
import { validInventory } from "@/lib/inventory";
import { get } from "@vercel/blob";

// Read-only probe of the private test-drive store. A missing sentinel returns
// null (404) when the token is valid and the store is private; any thrown
// BlobError means the token or store access mode is misconfigured.
async function testDriveStoreReachable() {
  const token = process.env.TEST_DRIVE_BLOB_READ_WRITE_TOKEN;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(process.env.TEST_DRIVE_ENCRYPTION_KEY || "")) return false;
  try { await get("test-drive/health/probe-does-not-exist", { access: "private", token, useCache: false }); return true; }
  catch { return false; }
}

export async function GET(request: Request) {
  if (!await isAdmin(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers: privateResponseHeaders() });
  const checks = {
    recovery: recoveryConfigured(),
    reporting: !!process.env.BUG_REPORT_ORIGIN && /^[A-Za-z0-9_-]{43}$/.test(process.env.BUG_REPORT_ENCRYPTION_KEY || "") && (process.env.BUG_REPORT_RATE_LIMIT_SECRET?.length || 0) >= 32,
    deliveryTest: !!process.env.SECURITY_TEST_TARGET_URL && (process.env.SECURITY_CONSOLE_TEST_SECRET?.length || 0) >= 32,
    inventory: false,
    testDriveStorage: false,
    testDriveLimiter: !!getRedis(),
  };
  checks.testDriveStorage = await testDriveStoreReachable();
  try {
    const state = await getRedis()?.get<{ version: number; revision: string; vehicles: unknown }>(inventoryStateKey);
    checks.inventory = state?.version === 2 && typeof state.revision === "string" && !!state.revision && validInventory(state.vehicles);
  } catch { /* report unavailable without provider details */ }
  return Response.json({ healthy: Object.values(checks).every(Boolean), checks }, { headers: privateResponseHeaders() });
}
