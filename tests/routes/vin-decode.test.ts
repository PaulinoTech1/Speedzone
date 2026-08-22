import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as vinDecodeRoute from "@/app/api/vin-decode/route";
import { resetRateLimitsForTests } from "@/lib/server/rate-limit";

let requestSequence = 0;
const validVin = "1HGCM82633A004352";

function decodeRequest(vin: string, clientId = `vin-decode-${++requestSequence}`): NextRequest {
  return new NextRequest(`http://localhost:4173/api/vin-decode?vin=${encodeURIComponent(vin)}`, {
    headers: {
      "x-forwarded-for": clientId,
      "user-agent": "SpeedZone vin decode test",
    },
  });
}

function nhtsaResponse(overrides: Record<string, unknown> = {}): Response {
  const result = {
    ErrorCode: "0",
    ErrorText: "0 - VIN decoded clean. Check Digit (9th position) is correct",
    Make: "HONDA",
    Model: "Accord",
    ModelYear: "2003",
    Trim: "EX-V6",
    BodyClass: "Coupe",
    EngineCylinders: "6",
    DisplacementL: "2.998832712",
    TransmissionStyle: "Automatic",
    DriveType: "",
    FuelTypePrimary: "Gasoline",
    ...overrides,
  };
  return new Response(JSON.stringify({ Results: [result] }), { status: 200 });
}

async function responseBody(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

beforeEach(() => {
  resetRateLimitsForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("VIN decode route", () => {
  it("exports only the GET handler", () => {
    expect(typeof vinDecodeRoute.GET).toBe("function");
    expect("POST" in vinDecodeRoute).toBe(false);
  });

  it("rejects a malformed VIN without calling NHTSA", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await vinDecodeRoute.GET(decodeRequest("not-a-vin"));
    expect(response.status).toBe(422);
    await expect(responseBody(response)).resolves.toMatchObject({
      error: { code: "INVALID_VIN" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("decodes a clean VIN", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => nhtsaResponse()));
    const response = await vinDecodeRoute.GET(decodeRequest(validVin));
    expect(response.status).toBe(200);
    await expect(responseBody(response)).resolves.toEqual({
      ok: true,
      vehicle: {
        year: 2003,
        make: "HONDA",
        model: "Accord",
        trim: "EX-V6",
        bodyStyle: "Coupe",
        engine: "3.0L 6-cyl",
        transmission: "Automatic",
        drivetrain: null,
        fuelType: "Gasoline",
      },
      warning: null,
    });
  });

  it("surfaces a warning for a VIN with data-quality error codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        nhtsaResponse({
          ErrorCode: "1",
          ErrorText: "1 - Check Digit (9th position) does not calculate properly",
        }),
      ),
    );
    const response = await vinDecodeRoute.GET(decodeRequest(validVin));
    expect(response.status).toBe(200);
    const body = (await responseBody(response)) as { warning: string | null };
    expect(body.warning).toContain("double-check");
  });

  it("returns a friendly error when NHTSA can't decode the VIN at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        nhtsaResponse({ Make: "", Model: "", ErrorCode: "6,8", ErrorText: "6 - Incomplete VIN" }),
      ),
    );
    const response = await vinDecodeRoute.GET(decodeRequest(validVin));
    expect(response.status).toBe(422);
    await expect(responseBody(response)).resolves.toMatchObject({
      error: { code: "VIN_NOT_DECODED" },
    });
  });

  it("returns a 502 when NHTSA is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new Error("network down");
      }),
    );
    const response = await vinDecodeRoute.GET(decodeRequest(validVin));
    expect(response.status).toBe(502);
    await expect(responseBody(response)).resolves.toMatchObject({
      error: { code: "VIN_LOOKUP_FAILED" },
    });
  });

  it("returns a 502 when NHTSA responds with a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(null, { status: 500 })));
    const response = await vinDecodeRoute.GET(decodeRequest(validVin));
    expect(response.status).toBe(502);
  });

  it("rate limits repeated lookups from the same client", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => nhtsaResponse()));
    const clientId = "rate-limited-vin-client";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await vinDecodeRoute.GET(decodeRequest(validVin, clientId));
      expect(response.status).toBe(200);
    }
    const limited = await vinDecodeRoute.GET(decodeRequest(validVin, clientId));
    expect(limited.status).toBe(429);
  });
});
