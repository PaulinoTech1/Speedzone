import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const uploadMocks = vi.hoisted(() => ({
  verifyAndNormalizeWebP: vi.fn(),
  uploadVehiclePhoto: vi.fn(),
}));

const sanityMocks = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock("@/lib/server/photos", () => uploadMocks);

vi.mock("@sanity/client", () => ({
  ClientError: class ClientError extends Error {},
  createClient: vi.fn(() => ({ getDocument: sanityMocks.getDocument })),
}));

import { emptyAuthState, type AuthState } from "@/lib/domain/auth";
import type { VehiclePhoto } from "@/lib/domain/vehicle";
import { createSession, setSessionCookie } from "@/lib/server/auth/session";
import { issueCsrf } from "@/lib/server/csrf";

const vehicleId = "41903f0d-54f6-4ad7-b85d-2b07cb458a15";
let testDirectory = "";
let statePath = "";
let authState: AuthState;
let upload: (request: NextRequest) => Promise<Response>;

function vehicleDocument(photographCount = 0): { _type: string; photographs: unknown[] } {
  return { _type: "vehicle", photographs: Array.from({ length: photographCount }) };
}

async function writeState(): Promise<void> {
  await writeFile(statePath, `${JSON.stringify({ auth: authState }, null, 2)}\n`, "utf8");
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

function uploadRequest(input: {
  body?: Buffer;
  vehicleId?: string;
  alt?: string;
  contentType?: string;
  authorization?: { cookie: string; csrfToken: string };
}): NextRequest {
  const query = new URLSearchParams({
    vehicleId: input.vehicleId ?? vehicleId,
    alt: input.alt ?? "Front of vehicle",
  });
  const headers: Record<string, string> = {
    origin: "http://localhost:4173",
    "content-type": input.contentType ?? "image/webp",
    "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
  };
  if (input.authorization) {
    headers.cookie = input.authorization.cookie;
    headers["x-csrf-token"] = input.authorization.csrfToken;
  }
  return new NextRequest(`http://localhost:4173/api/admin/uploads?${query.toString()}`, {
    method: "POST",
    headers,
    // Buffer is a valid Fetch BodyInit at runtime; the DOM lib's stricter
    // Uint8Array<ArrayBuffer> generic just doesn't structurally admit it here.
    body: input.body as BodyInit | undefined,
  });
}

beforeAll(async () => {
  vi.resetModules();
  ({ POST: upload } = await import("@/app/api/admin/uploads/route"));
});

beforeEach(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "speedzone-upload-route-"));
  statePath = join(testDirectory, "state.json");
  process.env.LOCAL_STATE_PATH = statePath;
  vi.stubEnv("SANITY_PROJECT_ID", "fixture");
  vi.stubEnv("SANITY_DATASET", "test");
  vi.stubEnv("SANITY_API_TOKEN", "fixture-token");

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
  await writeState();

  sanityMocks.getDocument.mockReset();
  uploadMocks.verifyAndNormalizeWebP.mockReset();
  uploadMocks.uploadVehiclePhoto.mockReset();
  sanityMocks.getDocument.mockResolvedValue(vehicleDocument());
  uploadMocks.verifyAndNormalizeWebP.mockResolvedValue({
    buffer: Buffer.from("verified-webp"),
    width: 1200,
    height: 800,
  });
});

afterEach(async () => {
  delete process.env.LOCAL_STATE_PATH;
  vi.unstubAllEnvs();
  await rm(testDirectory, { recursive: true, force: true });
});

describe("authenticated photograph uploads", () => {
  it("rejects an upload with no session before touching storage", async () => {
    const response = await upload(uploadRequest({ body: Buffer.from([1, 2, 3]) }));
    expect(response.status).toBe(401);
    expect(sanityMocks.getDocument).not.toHaveBeenCalled();
    expect(uploadMocks.uploadVehiclePhoto).not.toHaveBeenCalled();
  });

  it("verifies, uploads, and returns the finalized photograph", async () => {
    const expectedPhoto: VehiclePhoto = {
      url: "https://cdn.sanity.io/images/fixture/production/abc-1200x800.webp",
      pathname: "image-abc123-1200x800-webp",
      width: 1200,
      height: 800,
      bytes: 13,
      alt: "Front of vehicle",
      createdAt: new Date().toISOString(),
    };
    uploadMocks.uploadVehiclePhoto.mockResolvedValue(expectedPhoto);
    const authorization = authenticatedHeaders();

    const response = await upload(
      uploadRequest({ body: Buffer.from([1, 2, 3]), authorization }),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ ok: true, photograph: expectedPhoto });
    expect(uploadMocks.uploadVehiclePhoto).toHaveBeenCalledWith({
      buffer: Buffer.from("verified-webp"),
      width: 1200,
      height: 800,
      alt: "Front of vehicle",
    });
  });

  it("rejects a vehicle that does not exist before reading the body", async () => {
    sanityMocks.getDocument.mockResolvedValue(undefined);
    const authorization = authenticatedHeaders();

    const response = await upload(
      uploadRequest({ body: Buffer.from([1, 2, 3]), authorization }),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(uploadMocks.verifyAndNormalizeWebP).not.toHaveBeenCalled();
    expect(uploadMocks.uploadVehiclePhoto).not.toHaveBeenCalled();
  });

  it("rejects a thirteenth photograph before reading the body", async () => {
    sanityMocks.getDocument.mockResolvedValue(vehicleDocument(12));
    const authorization = authenticatedHeaders();

    const response = await upload(
      uploadRequest({ body: Buffer.from([1, 2, 3]), authorization }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PHOTO_LIMIT_REACHED" } });
    expect(uploadMocks.uploadVehiclePhoto).not.toHaveBeenCalled();
  });

  it("rejects a non-WebP content type before checking the vehicle", async () => {
    const authorization = authenticatedHeaders();

    const response = await upload(
      uploadRequest({
        body: Buffer.from([1, 2, 3]),
        authorization,
        contentType: "image/jpeg",
      }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_UPLOAD" } });
    expect(sanityMocks.getDocument).not.toHaveBeenCalled();
  });

  it("rejects a body larger than the configured limit", async () => {
    const authorization = authenticatedHeaders();
    const oversized = Buffer.alloc(5 * 1024 * 1024);

    const response = await upload(uploadRequest({ body: oversized, authorization }));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "BODY_TOO_LARGE" } });
    expect(uploadMocks.uploadVehiclePhoto).not.toHaveBeenCalled();
  });

  it("rejects an invalid vehicleId before checking the vehicle", async () => {
    const authorization = authenticatedHeaders();

    const response = await upload(
      uploadRequest({ body: Buffer.from([1, 2, 3]), vehicleId: "not-a-uuid", authorization }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_UPLOAD_CONTEXT" } });
    expect(sanityMocks.getDocument).not.toHaveBeenCalled();
  });

  it("surfaces a validation failure from a malformed WebP payload", async () => {
    uploadMocks.verifyAndNormalizeWebP.mockRejectedValue(new Error("not a valid WebP image"));
    const authorization = authenticatedHeaders();

    const response = await upload(
      uploadRequest({ body: Buffer.from([1, 2, 3]), authorization }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_UPLOAD" } });
    expect(uploadMocks.uploadVehiclePhoto).not.toHaveBeenCalled();
  });
});
