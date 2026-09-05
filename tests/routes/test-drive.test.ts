import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { put } from "@vercel/blob";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async () => ({ url: "https://blob.test/private-lead.json" })),
}));

import * as testDriveRoute from "@/app/api/test-drive/route";
import { resetRateLimitsForTests } from "@/lib/server/rate-limit";

let requestSequence = 0;

function futureDate(daysFromNow = 3): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

function validBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    fullName: "Jamie Rivera",
    email: "jamie@example.com",
    phone: "(508) 826-9405",
    vehicleOfInterest: "2021 Ford Mustang GT",
    preferredDate: futureDate(),
    preferredTime: "morning",
    comments: "Looking forward to it!",
    ...overrides,
  });
}

function testDriveRequest(
  body: string,
  clientId = `test-drive-${++requestSequence}`,
  contentType: string | null = "application/json",
): NextRequest {
  const headers = new Headers({
    "x-forwarded-for": clientId,
    "user-agent": "SpeedZone test drive test",
  });
  if (contentType !== null) headers.set("content-type", contentType);
  return new NextRequest("http://localhost:4173/api/test-drive", {
    method: "POST",
    headers,
    body,
  });
}

async function responseBody(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

beforeEach(() => {
  vi.mocked(put).mockClear();
  resetRateLimitsForTests();
  vi.stubEnv("RESEND_API_KEY", "test-resend-key");
  vi.stubEnv("RESEND_FROM_EMAIL", "SpeedZone Motorsports <test-drive@speedzonems.test>");
  vi.stubEnv("LEAD_NOTIFICATION_EMAIL", "smpaulino.business@gmail.com");
  vi.stubEnv("Test_Drive", "test-blob-token");
  vi.stubEnv("Test_Drive_STORE_ID", "test-store-id");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: "email_123" }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("test drive request route", () => {
  it("exports only the POST handler", () => {
    expect(typeof testDriveRoute.POST).toBe("function");
    expect("GET" in testDriveRoute).toBe(false);
  });

  it("sends a notification email and returns 201 for a valid submission", async () => {
    const response = await testDriveRoute.POST(testDriveRequest(validBody()));
    expect(response.status).toBe(201);
    await expect(responseBody(response)).resolves.toEqual({ ok: true });

    expect(put).toHaveBeenCalledTimes(1);
    const [path, body, options] = vi.mocked(put).mock.calls[0]!;
    expect(path).toMatch(/^leads\/test-drive\/.+\.json$/);
    expect(JSON.parse(String(body))).toMatchObject({
      type: "test-drive-request",
      fullName: "Jamie Rivera",
    });
    expect(options).toMatchObject({
      access: "private",
      storeId: "test-store-id",
      token: "test-blob-token",
    });

    const mockedFetch = vi.mocked(fetch);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockedFetch.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    const payload = JSON.parse(String(init?.body)) as { to: string[]; subject: string; from: string };
    expect(payload.to).toEqual(["smpaulino.business@gmail.com"]);
    expect(payload.subject).toBe("New Test Drive Request - Jamie Rivera");
    expect(payload.from).toBe("SpeedZone Motorsports <test-drive@speedzonems.test>");
  });

  it("rejects an invalid submission without calling the email provider", async () => {
    const response = await testDriveRoute.POST(
      testDriveRequest(validBody({ email: "not-an-email" })),
    );
    expect(response.status).toBe(422);
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "Request validation failed" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a preferred date in the past", async () => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const response = await testDriveRoute.POST(
      testDriveRequest(validBody({ preferredDate: yesterday.toISOString().slice(0, 10) })),
    );
    expect(response.status).toBe(422);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a filled-in honeypot field without calling the email provider", async () => {
    const response = await testDriveRoute.POST(
      testDriveRequest(validBody({ website: "http://spam.example" })),
    );
    expect(response.status).toBe(422);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["RESEND_API_KEY", "RESEND_FROM_EMAIL"])("stores the request without email when %s is missing", async (variable) => {
    vi.stubEnv(variable, "");
    const response = await testDriveRoute.POST(testDriveRequest(validBody()));
    expect(response.status).toBe(201);
    await expect(responseBody(response)).resolves.toEqual({ ok: true });
    expect(put).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not report success or send email when storage fails", async () => {
    vi.mocked(put).mockRejectedValueOnce(new Error("sensitive-provider-token-and-lead"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await testDriveRoute.POST(testDriveRequest(validBody()));
    expect(response.status).toBe(503);
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      error: { code: "TD_STORAGE_WRITE", message: "Request storage is unavailable" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["Test_Drive", "Test_Drive_STORE_ID"])("identifies missing %s without writing or emailing", async (variable) => {
    vi.stubEnv(variable, "");
    const response = await testDriveRoute.POST(testDriveRequest(validBody()));
    expect(response.status).toBe(503);
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      error: { code: "TD_STORAGE_CONFIG", message: "Request storage is unavailable" },
    });
    expect(put).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["AUTH_COOKIE_SECRET", "TD_COOKIE_CONFIG"],
    ["ADMIN_PASSWORD_PEPPER", "TD_PEPPER_CONFIG"],
  ])("identifies invalid %s before validation without disclosing its value", async (variable, code) => {
    vi.stubEnv(variable, "sensitive-invalid-value!");
    const response = await testDriveRoute.POST(testDriveRequest("{}"));
    expect(response.status).toBe(503);
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      error: { code, message: "Request service is unavailable" },
    });
    expect(put).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces an upstream email failure as a generic server error", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(null, { status: 500 })));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await testDriveRoute.POST(testDriveRequest(validBody()));
    expect(response.status).toBe(500);
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      error: { code: "SERVER_ERROR", message: "The request could not be completed" },
    });
    error.mockRestore();
  });

  it("rejects a non-JSON content type", async () => {
    const response = await testDriveRoute.POST(
      testDriveRequest(validBody(), undefined, "text/plain"),
    );
    expect(response.status).toBe(415);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rate limits repeated submissions from the same client", async () => {
    const clientId = "rate-limited-test-drive-client";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await testDriveRoute.POST(testDriveRequest(validBody(), clientId));
      expect(response.status).toBe(201);
    }
    const limited = await testDriveRoute.POST(testDriveRequest(validBody(), clientId));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("does not let one saturated client consume another client's budget", async () => {
    const saturatedClient = "saturated-test-drive-client";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await testDriveRoute.POST(testDriveRequest(validBody(), saturatedClient));
    }
    const saturated = await testDriveRoute.POST(testDriveRequest(validBody(), saturatedClient));
    expect(saturated.status).toBe(429);

    const independent = await testDriveRoute.POST(
      testDriveRequest(validBody(), "independent-test-drive-client"),
    );
    expect(independent.status).toBe(201);
  });
});
