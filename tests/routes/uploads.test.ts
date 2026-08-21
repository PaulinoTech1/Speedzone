import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const uploadMocks = vi.hoisted(() => ({
  handleUpload: vi.fn(),
  finalizeVehiclePhoto: vi.fn(),
}));

vi.mock("@vercel/blob/client", () => ({
  handleUpload: uploadMocks.handleUpload,
}));

vi.mock("@/lib/server/photos", () => ({
  finalizeVehiclePhoto: uploadMocks.finalizeVehiclePhoto,
}));

import { emptyAuthState, type AuthState } from "@/lib/domain/auth";
import {
  emptyInventoryState,
  type InventoryState,
  type VehiclePhoto,
  type VehicleRecord,
} from "@/lib/domain/vehicle";
import {
  createSession,
  setSessionCookie,
} from "@/lib/server/auth/session";
import { issueCsrf } from "@/lib/server/csrf";

const vehicleId = "41903f0d-54f6-4ad7-b85d-2b07cb458a15";
let testDirectory = "";
let statePath = "";
let authState: AuthState;
let inventoryState: InventoryState;
let authorizeUpload: (request: NextRequest) => Promise<Response>;
let finalizeUpload: (request: NextRequest) => Promise<Response>;

function photograph(index: number): VehiclePhoto {
  return {
    url: `https://fixture.public.blob.vercel-storage.com/vehicles/${vehicleId}/${index}.webp`,
    pathname: `vehicles/${vehicleId}/${index}.webp`,
    width: 800,
    height: 600,
    bytes: 40_000,
    alt: `Vehicle photograph ${index}`,
    createdAt: new Date().toISOString(),
  };
}

function vehicle(photographs: VehiclePhoto[] = []): VehicleRecord {
  const timestamp = new Date().toISOString();
  return {
    id: vehicleId,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    stockNumber: "SZ-UPLOAD",
    vin: "1HGCM82633A004352",
    year: 2022,
    make: "Honda",
    model: "Accord",
    trim: "EX",
    price: 18_900,
    mileage: 42_000,
    exteriorColor: "Black",
    interiorColor: "Gray",
    bodyStyle: "Sedan",
    transmission: "Automatic",
    drivetrain: "FWD",
    fuelType: "Gasoline",
    engine: "1.5L",
    description: "Upload route fixture",
    features: ["Bluetooth"],
    status: "draft",
    slug: "upload-route-fixture",
    photographs,
  };
}

async function writeState(): Promise<void> {
  await writeFile(
    statePath,
    `${JSON.stringify({ auth: authState, inventory: inventoryState }, null, 2)}\n`,
    "utf8",
  );
}

function cookieHeader(response: NextResponse): string {
  return response.cookies
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function authenticatedHeaders(): { cookie: string; csrfToken: string } {
  const session = createSession(authState);
  const response = new NextResponse();
  setSessionCookie(response, session);
  const csrfToken = issueCsrf(response, session.sid);
  return { cookie: cookieHeader(response), csrfToken };
}

function uploadRequest(
  body: unknown,
  authorization?: { cookie: string; csrfToken: string },
): NextRequest {
  const headers: Record<string, string> = {
    origin: "http://localhost:4173",
    "content-type": "application/json",
    "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
  };
  if (authorization) {
    headers.cookie = authorization.cookie;
    headers["x-csrf-token"] = authorization.csrfToken;
  }
  return new NextRequest("http://localhost:4173/api/admin/uploads", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function uploadBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "blob.generate-client-token",
    payload: {
      pathname: `staging/vehicles/${vehicleId}/photo.webp`,
      multipart: false,
      clientPayload: JSON.stringify({ vehicleId }),
      ...overrides,
    },
  };
}

beforeAll(async () => {
  // Other test files exercise the real Blob decoder. Refresh the module graph
  // here so these route tests always receive their explicit Blob boundary mocks.
  vi.resetModules();
  const [authorizationRoute, finalizeRoute] = await Promise.all([
    import("@/app/api/admin/uploads/route"),
    import("@/app/api/admin/uploads/finalize/route"),
  ]);
  authorizeUpload = authorizationRoute.POST;
  finalizeUpload = finalizeRoute.POST;
});

beforeEach(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "speedzone-upload-route-"));
  statePath = join(testDirectory, "state.json");
  process.env.LOCAL_STATE_PATH = statePath;
  process.env.BLOB_PRIVATE_READ_WRITE_TOKEN = "test-private-blob-token";
  process.env.BLOB_PHOTO_READ_WRITE_TOKEN = "test-public-photo-token";

  authState = {
    ...emptyAuthState(),
    state: "ACTIVE",
    administratorUserId: "test-administrator",
    passkeys: [
      {
        id: "upload-test-passkey",
        publicKey: "AQID",
        counter: 0,
        transports: ["internal"],
        createdAt: "2026-08-20T12:00:00.000Z",
        label: "Upload test passkey",
      },
    ],
    recoveryCodeHashes: ["a".repeat(64)],
  };
  inventoryState = { ...emptyInventoryState(), vehicles: [vehicle()] };
  await writeState();

  uploadMocks.handleUpload.mockReset();
  uploadMocks.finalizeVehiclePhoto.mockReset();
  uploadMocks.handleUpload.mockImplementation(async (input: {
    body: {
      payload: { pathname: string; clientPayload: string | null; multipart: boolean };
    };
    onBeforeGenerateToken: (
      pathname: string,
      clientPayload: string | null,
      multipart: boolean,
    ) => Promise<unknown>;
  }) => {
    const policy = await input.onBeforeGenerateToken(
      input.body.payload.pathname,
      input.body.payload.clientPayload,
      input.body.payload.multipart,
    );
    return { type: "blob.generate-client-token", clientToken: "test-only-token", policy };
  });
});

afterEach(async () => {
  delete process.env.LOCAL_STATE_PATH;
  delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  delete process.env.BLOB_PHOTO_READ_WRITE_TOKEN;
  await rm(testDirectory, { recursive: true, force: true });
});

describe("authenticated photograph uploads", () => {
  it("rejects upload authorization and finalization before Blob access without a session", async () => {
    const authorizationResponse = await authorizeUpload(uploadRequest(uploadBody()));
    expect(authorizationResponse.status).toBe(401);
    expect(uploadMocks.handleUpload).not.toHaveBeenCalled();

    const finalizeResponse = await finalizeUpload(
      uploadRequest({
        vehicleId,
        stagingUrl: `https://fixture.private.blob.vercel-storage.com/staging/vehicles/${vehicleId}/photo-ABC.webp`,
        alt: "Vehicle",
      }),
    );
    expect(finalizeResponse.status).toBe(401);
    expect(uploadMocks.finalizeVehiclePhoto).not.toHaveBeenCalled();
  });

  it("binds a short-lived WebP-only authorization to an existing vehicle path", async () => {
    const response = await authorizeUpload(uploadRequest(uploadBody(), authenticatedHeaders()));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      policy: {
        allowedContentTypes: string[];
        maximumSizeInBytes: number;
        validUntil: number;
        addRandomSuffix: boolean;
        allowOverwrite: boolean;
        tokenPayload: string;
      };
    };
    expect(body.policy).toMatchObject({
      allowedContentTypes: ["image/webp"],
      maximumSizeInBytes: 4 * 1024 * 1024,
      addRandomSuffix: true,
      allowOverwrite: false,
    });
    expect(body.policy.validUntil).toBeGreaterThan(Date.now());
    expect(JSON.parse(body.policy.tokenPayload)).toEqual({ vehicleId });
  });

  it("rejects cross-vehicle paths, missing records, multipart uploads, and the thirteenth photo", async () => {
    const otherId = randomUUID();
    const authorization = authenticatedHeaders();

    const crossVehicle = await authorizeUpload(
      uploadRequest(
        uploadBody({ pathname: `staging/vehicles/${otherId}/photo.webp` }),
        authorization,
      ),
    );
    expect(crossVehicle.status).toBe(422);
    await expect(crossVehicle.json()).resolves.toMatchObject({
      error: { code: "INVALID_UPLOAD_PATH" },
    });

    const missingVehicle = await authorizeUpload(
      uploadRequest(
        uploadBody({
          pathname: `staging/vehicles/${otherId}/photo.webp`,
          clientPayload: JSON.stringify({ vehicleId: otherId }),
        }),
        authorization,
      ),
    );
    expect(missingVehicle.status).toBe(404);
    await expect(missingVehicle.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });

    const multipart = await authorizeUpload(
      uploadRequest(uploadBody({ multipart: true }), authorization),
    );
    expect(multipart.status).toBe(422);
    await expect(multipart.json()).resolves.toMatchObject({ error: { code: "INVALID_UPLOAD" } });

    inventoryState = {
      ...inventoryState,
      vehicles: [vehicle(Array.from({ length: 12 }, (_, index) => photograph(index)))],
    };
    await writeState();
    const overCount = await authorizeUpload(
      uploadRequest(uploadBody(), authenticatedHeaders()),
    );
    expect(overCount.status).toBe(422);
    await expect(overCount.json()).resolves.toMatchObject({
      error: { code: "PHOTO_LIMIT_REACHED" },
    });
  });

  it("finalizes only a canonical staging path owned by the requested vehicle", async () => {
    const expectedPhoto = photograph(99);
    uploadMocks.finalizeVehiclePhoto.mockResolvedValue(expectedPhoto);
    const authorization = authenticatedHeaders();
    const stagingUrl =
      `https://fixture.private.blob.vercel-storage.com/staging/vehicles/${vehicleId}/photo-ABC123.webp`;

    const response = await finalizeUpload(
      uploadRequest({ vehicleId, stagingUrl, alt: "Front of vehicle" }, authorization),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ ok: true, photograph: expectedPhoto });
    expect(uploadMocks.finalizeVehiclePhoto).toHaveBeenCalledWith({
      vehicleId,
      stagingUrl: `staging/vehicles/${vehicleId}/photo-ABC123.webp`,
      alt: "Front of vehicle",
    });

    uploadMocks.finalizeVehiclePhoto.mockClear();
    const otherId = randomUUID();
    const crossVehicle = await finalizeUpload(
      uploadRequest(
        {
          vehicleId,
          stagingUrl:
            `https://fixture.private.blob.vercel-storage.com/staging/vehicles/${otherId}/photo-ABC123.webp`,
          alt: "Vehicle",
        },
        authorization,
      ),
    );
    expect(crossVehicle.status).toBe(422);
    expect(uploadMocks.finalizeVehiclePhoto).not.toHaveBeenCalled();

    const untrustedHost = await finalizeUpload(
      uploadRequest(
        {
          vehicleId,
          stagingUrl: `https://evil.example/staging/vehicles/${vehicleId}/photo-ABC123.webp`,
          alt: "Vehicle",
        },
        authorization,
      ),
    );
    expect(untrustedHost.status).toBe(422);
    expect(uploadMocks.finalizeVehiclePhoto).not.toHaveBeenCalled();
  });
});
