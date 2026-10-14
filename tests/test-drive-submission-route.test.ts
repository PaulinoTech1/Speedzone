import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), send: vi.fn(), event: vi.fn() }));
vi.mock("@vercel/blob", () => ({ get: mocks.get, put: mocks.put }));
vi.mock("resend", () => ({ Resend: class { emails = { send: mocks.send }; } }));
vi.mock("@/lib/test-drive-crypto", () => ({ encryptTestDrivePayload: async (value: unknown) => JSON.stringify(value), decryptTestDrivePayload: async (value: string) => JSON.parse(value) }));
vi.mock("@/lib/test-drive-rate-limit", () => ({
  getRequestKeys: () => ({ ip: "test", contact: "test" }),
  limitTestDriveSubmission: async () => ({ configured: true, success: true }),
}));
vi.mock("@/lib/security-events", () => ({ securityRequestContext: () => ({}), writeSecurityEvent: mocks.event }));

import { POST } from "@/app/api/test-drive/route";

const valid = { name: "Test Customer", email: "customer@example.com", phone: "5085550100", requestId: "11111111-1111-4111-8111-111111111111", vehicle: "Test vehicle", date: "2099-01-05", time: "10:00 AM", notes: "Synthetic request" };
function request(body: string = new URLSearchParams(valid).toString(), headers: Record<string, string> = {}) {
  return new Request("https://www.speedzonems.com/api/test-drive", { method: "POST", body, headers: { origin: "https://www.speedzonems.com", "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded", ...headers } });
}

describe("test-drive acceptance and notification", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("TEST_DRIVE_BLOB_READ_WRITE_TOKEN", "synthetic-token");
    vi.stubEnv("RESEND_API_KEY", "synthetic-key");
    vi.stubEnv("RESEND_EMAIL_DOMAIN", "example.com");
    vi.stubEnv("TEST_DRIVE_NOTIFICATION_EMAIL", "staff@example.com");
    mocks.get.mockResolvedValue(null);
    mocks.put.mockResolvedValue({});
    mocks.send.mockResolvedValue({ error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("accepts a stored request even when notification throws", async () => {
    mocks.send.mockRejectedValue(new Error("Provider unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, id: "11111111-1111-4111-8111-111111111111" });
    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ reason: "encrypted_submission_stored" }));
  });

  it("accepts a stored request when the provider returns an error", async () => {
    mocks.send.mockResolvedValue({ error: { message: "Provider unavailable" } });
    expect((await POST(request())).status).toBe(201);
  });

  it("does not send a notification or report success when storage fails", async () => {
    mocks.put.mockRejectedValue(new Error("Storage unavailable"));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.event).toHaveBeenCalledOnce();
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", reason: "storage_write_failed", metadata: { failure_stage: "storage_write", error_class: "Error" } }));
  });

  it("attributes encryption failures without customer data", async () => {
    const crypto = await import("@/lib/test-drive-crypto");
    vi.spyOn(crypto, "encryptTestDrivePayload").mockRejectedValueOnce(new TypeError("bad key"));
    expect((await POST(request())).status).toBe(500);
    const event = mocks.event.mock.calls[0]?.[0];
    expect(event).toMatchObject({ reason: "encryption_failed", metadata: { failure_stage: "encryption", error_class: "TypeError" } });
    expect(JSON.stringify(event)).not.toContain("customer@example.com");
  });

  it("sends readable notification text after storing the request", async () => {
    expect((await POST(request())).status).toBe(201);
    expect(mocks.send.mock.calls[0]?.[0].text).toContain("\nSubmission ID:");
    expect(mocks.put.mock.invocationCallOrder[0]).toBeLessThan(mocks.send.mock.invocationCallOrder[0]!);
  });
  it("reconciles a lost storage response without creating another record", async () => {
    let saved: string | null = null;
    mocks.get.mockImplementation(async () => saved ? { stream: new Response(saved).body } : null);
    mocks.put.mockImplementation(async (_path, body) => { saved = body; throw new Error("Response lost after commit"); });
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.put).toHaveBeenCalledOnce();
  });
  it("rejects a reused reference with different customer details", async () => {
    let saved: string | null = null;
    mocks.get.mockImplementation(async () => saved ? { stream: new Response(saved).body } : null);
    mocks.put.mockImplementation(async (_path, body) => { saved = body; return {}; });
    expect((await POST(request())).status).toBe(201);
    saved = JSON.stringify({ ...JSON.parse(saved!), name: "Different customer" });
    expect((await POST(request())).status).toBe(409);
    expect(mocks.put).toHaveBeenCalledOnce();
  });
  it("does not fall back to the public inventory token", async () => {
    vi.stubEnv("TEST_DRIVE_BLOB_READ_WRITE_TOKEN", ""); vi.stubEnv("BLOB_READ_WRITE_TOKEN", "public-token");
    expect((await POST(request())).status).toBe(503); expect(mocks.put).not.toHaveBeenCalled();
  });

  describe("request boundary", () => {
    const rejects = (status: number) => async (req: Request) => { const response = await POST(req); expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toContain("no-store"); expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled(); };
    it("rejects a missing or foreign Origin", async () => {
      await rejects(403)(request(undefined, { origin: "" }));
      await rejects(403)(request(undefined, { origin: "https://evil.example" }));
      await rejects(403)(request(undefined, { origin: "https://speedzonems.com" })); // allowlisted but not this host
    });
    it("rejects cross-site and same-site Fetch Metadata", async () => {
      await rejects(403)(request(undefined, { "sec-fetch-site": "cross-site" }));
      await rejects(403)(request(undefined, { "sec-fetch-site": "same-site" }));
    });
    it("enforces the form content type", async () => {
      await rejects(415)(request(JSON.stringify(valid), { "content-type": "application/json" }));
      const multipart = new FormData(); for (const [k, v] of Object.entries(valid)) multipart.set(k, v);
      const req = new Request("https://www.speedzonems.com/api/test-drive", { method: "POST", body: multipart, headers: { origin: "https://www.speedzonems.com" } });
      await rejects(415)(req);
    });
    it("caps the streamed body at 8 KB even without a content-length", async () => {
      await rejects(413)(request(new URLSearchParams({ ...valid, notes: "x".repeat(9000) }).toString()));
      const stream = new ReadableStream({ start(controller) { for (let i = 0; i < 20; i++) controller.enqueue(new TextEncoder().encode("notes=" + "y".repeat(1000) + "&")); controller.close(); } });
      await rejects(413)(new Request("https://www.speedzonems.com/api/test-drive", { method: "POST", body: stream, duplex: "half", headers: { origin: "https://www.speedzonems.com", "content-type": "application/x-www-form-urlencoded" } } as RequestInit));
    });
    it("rejects unknown and duplicate fields", async () => {
      await rejects(400)(request(new URLSearchParams({ ...valid, admin: "1" }).toString()));
      await rejects(400)(request(new URLSearchParams(valid).toString() + "&email=other%40example.com"));
    });
    it("marks success responses no-store", async () => {
      const response = await POST(request());
      expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toContain("no-store");
    });
  });
});
