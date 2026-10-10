import { isAdmin, privateResponseHeaders } from "@/lib/admin-auth";
import { recoveryConfigured } from "@/lib/admin-recovery";
import { getRedis } from "@/lib/redis";
import { inventoryStateKey } from "@/lib/inventory-state";
import { validInventory } from "@/lib/inventory";

export async function GET(request: Request) {
  if (!await isAdmin(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers: privateResponseHeaders() });
  const checks = {
    recovery: recoveryConfigured(),
    reporting: !!process.env.BUG_REPORT_ORIGIN && /^[A-Za-z0-9_-]{43}$/.test(process.env.BUG_REPORT_ENCRYPTION_KEY || "") && (process.env.BUG_REPORT_RATE_LIMIT_SECRET?.length || 0) >= 32,
    deliveryTest: !!process.env.SECURITY_TEST_TARGET_URL && (process.env.SECURITY_CONSOLE_TEST_SECRET?.length || 0) >= 32,
    inventory: false,
  };
  try {
    const state = await getRedis()?.get<{ version: number; revision: string; vehicles: unknown }>(inventoryStateKey);
    checks.inventory = state?.version === 2 && typeof state.revision === "string" && !!state.revision && validInventory(state.vehicles);
  } catch { /* report unavailable without provider details */ }
  return Response.json({ healthy: Object.values(checks).every(Boolean), checks }, { headers: privateResponseHeaders() });
}
