import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as tradeInRoute from "@/app/api/trade-in/route";
import { resetRateLimitsForTests } from "@/lib/server/rate-limit";

let requestSequence = 0;

function validBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    fullName: "Jamie Rivera",
    email: "jamie@example.com",
    phone: "(508) 826-9405",
    vin: "",
    year: 2019,
    make: "Toyota",
    model: "Camry",
    trim: "SE",
    bodyStyle: "",
    engine: "",
    transmission: "",
    drivetrain: "",
    fuelType: "",
    mileage: 45000,
    condition: "good",
    comments: "Clean title, one owner.",
    ...overrides,
  });
}

function tradeInRequest(
  body: string,
  clientId = `trade-in-${++requestSequence}`,
  contentType: string | null = "application/json",
): NextRequest {
  const headers = new Headers({
    "x-forwarded-for": clientId,
    "user-agent": "SpeedZone trade-in test",
  });
  if (contentType !== null) headers.set("content-type", contentType);
  return new NextRequest("http://localhost:4173/api/trade-in", {
    method: "POST",
    headers,
    body,
  });
}

async function responseBody(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

beforeEach(() => {
  resetRateLimitsForTests();
  vi.stubEnv("RESEND_API_KEY", "test-resend-key");
  vi.stubEnv("RESEND_FROM_EMAIL", "SpeedZone Motorsports <leads@speedzonems.test>");
  vi.stubEnv("LEAD_NOTIFICATION_EMAIL", "smpaulino.business@gmail.com");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: "email_123" }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("trade-in request route", () => {
  it("exports only the POST handler", () => {
    expect(typeof tradeInRoute.POST).toBe("function");
    expect("GET" in tradeInRoute).toBe(false);
  });

  it("sends a notification email and returns 201 for a valid submission", async () => {
    const response = await tradeInRoute.POST(tradeInRequest(validBody()));
    expect(response.status).toBe(201);
    await expect(responseBody(response)).resolves.toEqual({ ok: true });

    const mockedFetch = vi.mocked(fetch);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockedFetch.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    const payload = JSON.parse(String(init?.body)) as { to: string[]; subject: string };
    expect(payload.to).toEqual(["smpaulino.business@gmail.com"]);
    expect(payload.subject).toBe("New Sell/Trade-In Request - Jamie Rivera");
  });

  it("includes decoded specs in the email body when present", async () => {
    await tradeInRoute.POST(
      tradeInRequest(validBody({ engine: "3.5L V6", transmission: "Automatic" })),
    );
    const mockedFetch = vi.mocked(fetch);
    const [, init] = mockedFetch.mock.calls[0]!;
    const payload = JSON.parse(String(init?.body)) as { text: string };
    expect(payload.text).toContain("Engine: 3.5L V6");
    expect(payload.text).toContain("Transmission: Automatic");
  });

  it("rejects an invalid submission without calling the email provider", async () => {
    const response = await tradeInRoute.POST(tradeInRequest(validBody({ make: "" })));
    expect(response.status).toBe(422);
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "Request validation failed" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a filled-in honeypot field without calling the email provider", async () => {
    const response = await tradeInRoute.POST(
      tradeInRequest(validBody({ website: "http://spam.example" })),
    );
    expect(response.status).toBe(422);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 503 when the email service is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const response = await tradeInRoute.POST(tradeInRequest(validBody()));
    expect(response.status).toBe(503);
    await expect(responseBody(response)).resolves.toEqual({
      ok: false,
      error: { code: "SERVICE_NOT_CONFIGURED", message: "Email service is not configured" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON content type", async () => {
    const response = await tradeInRoute.POST(
      tradeInRequest(validBody(), undefined, "text/plain"),
    );
    expect(response.status).toBe(415);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rate limits repeated submissions from the same client", async () => {
    const clientId = "rate-limited-trade-in-client";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await tradeInRoute.POST(tradeInRequest(validBody(), clientId));
      expect(response.status).toBe(201);
    }
    const limited = await tradeInRoute.POST(tradeInRequest(validBody(), clientId));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});
