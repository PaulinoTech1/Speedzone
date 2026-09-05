// Prevention regressions for the weaknesses reproduced at d3e2197.
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/server/storage/state", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/storage/state")>("@/lib/server/storage/state");
  return { ...actual, readAuthState: vi.fn() };
});
vi.mock("@/lib/server/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/rate-limit")>("@/lib/server/rate-limit");
  return { ...actual, progressiveFailureDelay: vi.fn(async () => undefined) };
});

import { POST as loginOptions } from "@/app/api/admin/auth/webauthn/options/route";
import { emptyAuthState, type AuthState } from "@/lib/domain/auth";
import { createPreAuthentication, setPreAuthenticationCookie } from "@/lib/server/auth/session";
import { issueCsrf } from "@/lib/server/csrf";
import { resetRateLimitsForTests } from "@/lib/server/rate-limit";
import { parseJsonBody, parseStrictJsonBody } from "@/lib/server/request";
import { enforceClientRateLimit } from "@/lib/server/route-utils";
import { readAuthState } from "@/lib/server/storage/state";

beforeEach(() => {
  resetRateLimitsForTests();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function request(userAgent: string, ip = "192.0.2.10", headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:4173/api/admin/auth/webauthn/options", {
    method: "POST",
    headers: { origin: "http://localhost:4173", "x-forwarded-for": ip, "user-agent": userAgent, ...headers },
  });
}

describe("2026-09-05 security regressions (no external services)", () => {
  it.each(["password", "testDrive"] as const)("%s limit survives User-Agent changes", async (policy) => {
    for (let n = 0; n < 5; n++) await enforceClientRateLimit(request(`agent-${n}`), policy);
    await expect(enforceClientRateLimit(request("agent-A"), policy)).rejects.toThrow("Rate limit exceeded");
    await expect(enforceClientRateLimit(request("agent-B"), policy)).rejects.toThrow("Rate limit exceeded");
    await expect(enforceClientRateLimit(request("agent-B", "192.0.2.20"), policy)).resolves.toBeUndefined();
  });

  it("unauthenticated traffic cannot spend a different client's valid login budget", async () => {
    const state: AuthState = {
      ...emptyAuthState(), state: "ACTIVE", administratorUserId: "audit-admin",
      passkeys: [{ id: "audit-passkey", publicKey: "AQID", counter: 0,
        label: "Audit", createdAt: "2026-09-05T00:00:00.000Z" }],
      recoveryCodeHashes: ["a".repeat(64)],
    };
    vi.mocked(readAuthState).mockResolvedValue(state);
    const source = new NextResponse();
    const claims = createPreAuthentication(state);
    setPreAuthenticationCookie(source, claims);
    const csrf = issueCsrf(source, claims.sid);
    const headers = {
      cookie: source.cookies.getAll().map(({ name, value }) => `${name}=${value}`).join("; "),
      "x-csrf-token": csrf,
    };
    for (let n = 0; n < 10; n++) {
      expect((await loginOptions(request("anonymous"))).status).toBe(401);
    }
    expect((await loginOptions(request("anonymous"))).status).toBe(429);
    expect((await loginOptions(request("real-admin", "192.0.2.20", headers))).status).toBe(200);
  });

  it("both JSON parser entrypoints stop reading at the byte cap", async () => {
    async function measure(strict: boolean) {
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulls === 64) { controller.close(); return; }
          pulls++;
          controller.enqueue(new Uint8Array(4096).fill(32));
        },
      }, { highWaterMark: 0 });
      const input = new NextRequest("http://localhost:4173/api/admin/example", {
        method: "POST", headers: { "content-type": "application/json" }, body,
        duplex: "half",
      } as ConstructorParameters<typeof NextRequest>[1]);
      await expect((strict ? parseStrictJsonBody : parseJsonBody)(input, z.object({}), 4096))
        .rejects.toMatchObject({ status: 413 });
      return pulls;
    }
    expect(await measure(false)).toBe(2);
    expect(await measure(true)).toBe(2);
  });
});
