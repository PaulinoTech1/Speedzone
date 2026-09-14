import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ isAdmin: vi.fn(), isAdminSetup: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ ...auth, privateResponseHeaders: () => ({ "Cache-Control": "private, no-store" }) }));
import { GET } from "@/app/api/admin/session/route";
beforeEach(() => { vi.resetAllMocks(); });
it.each([[false, false, "signed-out"], [false, true, "setup"], [true, false, "authenticated"]])("distinguishes session purposes %s %s", async (passkey, setup, state) => {
 auth.isAdmin.mockResolvedValue(passkey); auth.isAdminSetup.mockResolvedValue(setup);
 const response = await GET(); expect(await response.json()).toEqual({ state }); expect(response.headers.get("cache-control")).toContain("no-store");
});
