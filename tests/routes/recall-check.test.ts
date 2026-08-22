import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as recallRoute from "@/app/api/recall-check/route";
import { resetRateLimitsForTests } from "@/lib/server/rate-limit";

let requestSequence = 0;
const validVin = "1HGCM82633A004352";

function recallRequest(vin: string, clientId = `recall-${++requestSequence}`): NextRequest {
  return new NextRequest(`http://localhost:4173/api/recall-check?vin=${encodeURIComponent(vin)}`, {
    headers: {
      "x-forwarded-for": clientId,
      "user-agent": "SpeedZone recall test",
    },
  });
}

function decodeResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      Results: [
        {
          ErrorCode: "0",
          Make: "Honda",
          Model: "Accord",
          ModelYear: "2003",
          Trim: "EX-V6",
          BodyClass: "Coupe",
          ...overrides,
        },
      ],
    }),
    { status: 200 },
  );
}

function recallsResponse(count = 1): Response {
  return new Response(
    JSON.stringify({
      Count: count,
      results: Array.from({ length: count }, (_unused, index) => ({
        NHTSACampaignNumber: `19V18200${index}`,
        Component: "AIR BAGS:FRONTAL:DRIVER SIDE:INFLATOR MODULE",
        Summary: "Honda is recalling certain vehicles.",
        Consequence: "An inflator explosion may result in injury.",
        Remedy: "Dealers will replace the inflator free of charge.",
        ReportReceivedDate: "06/03/2019",
        parkIt: false,
        parkOutSide: false,
      })),
    }),
    { status: 200 },
  );
}

/** Routes both NHTSA calls: vPIC decode first, then the recalls lookup. */
function stubNhtsa(decode: () => Response, recalls: () => Response) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes("vpic.nhtsa.dot.gov")) return decode();
    if (url.includes("api.nhtsa.gov/recalls")) return recalls();
    throw new Error(`Unexpected fetch to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

describe("recall check route", () => {
  it("exports only the GET handler", () => {
    expect(typeof recallRoute.GET).toBe("function");
    expect("POST" in recallRoute).toBe(false);
  });

  it("rejects a malformed VIN without calling NHTSA", async () => {
    const fetchMock = stubNhtsa(decodeResponse, () => recallsResponse());
    const response = await recallRoute.GET(recallRequest("nope"));
    expect(response.status).toBe(422);
    await expect(responseBody(response)).resolves.toMatchObject({
      error: { code: "INVALID_VIN" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("decodes the VIN, then looks up recalls by year/make/model", async () => {
    const fetchMock = stubNhtsa(decodeResponse, () => recallsResponse(2));
    const response = await recallRoute.GET(recallRequest(validVin));
    expect(response.status).toBe(200);

    const body = (await responseBody(response)) as {
      vehicle: { year: number; make: string; model: string };
      campaigns: unknown[];
    };
    expect(body.vehicle).toMatchObject({ year: 2003, make: "Honda", model: "Accord" });
    expect(body.campaigns).toHaveLength(2);

    // The recalls API is keyed by year/make/model; a VIN param returns nothing.
    const recallUrl = String(fetchMock.mock.calls[1]![0]);
    expect(recallUrl).toContain("modelYear=2003");
    expect(recallUrl).toContain("make=Honda");
    expect(recallUrl).toContain("model=Accord");
    expect(recallUrl).not.toContain("vin=");
  });

  it("reports a clean model with an empty campaign list, not an error", async () => {
    stubNhtsa(decodeResponse, () => recallsResponse(0));
    const response = await recallRoute.GET(recallRequest(validVin));
    expect(response.status).toBe(200);
    await expect(responseBody(response)).resolves.toMatchObject({ ok: true, campaigns: [] });
  });

  it("rejects a VIN that decodes without enough detail to look up recalls", async () => {
    const fetchMock = stubNhtsa(
      () => decodeResponse({ ModelYear: "", Model: "" }),
      () => recallsResponse(),
    );
    const response = await recallRoute.GET(recallRequest(validVin));
    expect(response.status).toBe(422);
    await expect(responseBody(response)).resolves.toMatchObject({
      error: { code: "VIN_NOT_DECODED" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a 502 when NHTSA is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new Error("network down");
      }),
    );
    const response = await recallRoute.GET(recallRequest(validVin));
    expect(response.status).toBe(502);
    await expect(responseBody(response)).resolves.toMatchObject({
      error: { code: "VIN_LOOKUP_FAILED" },
    });
  });

  it("rate limits repeated lookups from the same client", async () => {
    stubNhtsa(decodeResponse, () => recallsResponse());
    const clientId = "rate-limited-recall-client";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await recallRoute.GET(recallRequest(validVin, clientId));
      expect(response.status).toBe(200);
    }
    const limited = await recallRoute.GET(recallRequest(validVin, clientId));
    expect(limited.status).toBe(429);
  });
});
