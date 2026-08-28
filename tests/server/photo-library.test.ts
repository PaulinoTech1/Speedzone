import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  pages: new Map<string, Array<{ blobs: unknown[]; cursor?: string; hasMore: boolean }>>(),
  listCalls: [] as Array<{ prefix?: string; token?: string; cursor?: string }>,
  deleted: [] as Array<{ url: string; token?: string }>,
  vehicles: [] as unknown[],
}));

vi.mock("@vercel/blob", () => ({
  BlobPreconditionFailedError: class extends Error {},
  get: vi.fn(),
  put: vi.fn(),
  list: vi.fn(async (options: { prefix?: string; token?: string; cursor?: string }) => {
    store.listCalls.push({ prefix: options.prefix, token: options.token, cursor: options.cursor });
    const pages = store.pages.get(options.prefix ?? "") ?? [{ blobs: [], hasMore: false }];
    const index = options.cursor ? Number(options.cursor) : 0;
    return pages[index] ?? { blobs: [], hasMore: false };
  }),
  del: vi.fn(async (url: string, options: { token?: string }) => {
    store.deleted.push({ url, token: options.token });
  }),
}));

vi.mock("@/lib/server/inventory", () => ({
  listAllVehicles: vi.fn(async () => ({
    schemaVersion: 1,
    revision: 3,
    vehicles: store.vehicles,
  })),
}));

import {
  deleteOrphanedPhoto,
  PhotoLibraryDeletionError,
  readPhotoLibrary,
} from "@/lib/server/photo-library";

const vehicleId = "11111111-1111-4111-8111-111111111111";
const otherVehicleId = "22222222-2222-4222-8222-222222222222";

function blob(pathname: string, size: number, uploadedAt = "2026-08-20T12:00:00.000Z") {
  return {
    pathname,
    url: `https://store.public.blob.vercel-storage.com/${pathname}`,
    downloadUrl: `https://store.public.blob.vercel-storage.com/${pathname}?download=1`,
    size,
    uploadedAt: new Date(uploadedAt),
    etag: `etag-${pathname}`,
  };
}

function photo(pathname: string) {
  return {
    url: `https://store.public.blob.vercel-storage.com/${pathname}`,
    pathname,
    width: 1600,
    height: 1067,
    bytes: 400,
    alt: "Front three quarter",
    createdAt: "2026-08-20T12:00:00.000Z",
  };
}

function vehicle(id: string, photographs: ReturnType<typeof photo>[]) {
  return {
    id,
    version: 1,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
    stockNumber: "A1",
    vin: "1HGCM82633A004352",
    year: 2019,
    make: "Honda",
    model: "Civic",
    trim: "EX",
    price: 15000,
    mileage: 60000,
    exteriorColor: "",
    interiorColor: "",
    bodyStyle: "",
    transmission: "",
    drivetrain: "",
    fuelType: "",
    engine: "",
    description: "",
    features: [],
    status: "published" as const,
    slug: "2019-honda-civic",
    photographs,
  };
}

beforeEach(() => {
  store.pages.clear();
  store.listCalls = [];
  store.deleted = [];
  store.vehicles = [];
  vi.stubEnv("BLOB_PHOTO_READ_WRITE_TOKEN", "photo-token");
  vi.stubEnv("BLOB_PRIVATE_READ_WRITE_TOKEN", "private-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("photo library reconciliation", () => {
  it("classifies stored objects against the inventory record", async () => {
    store.vehicles = [vehicle(vehicleId, [photo(`vehicles/${vehicleId}/in-use.webp`)])];
    store.pages.set("vehicles/", [
      {
        blobs: [
          blob(`vehicles/${vehicleId}/in-use.webp`, 400),
          blob(`vehicles/${vehicleId}/replaced.webp`, 350),
          blob(`vehicles/${otherVehicleId}/deleted-vehicle.webp`, 300),
        ],
        hasMore: false,
      },
    ]);
    store.pages.set("staging/vehicles/", [
      { blobs: [blob(`staging/vehicles/${vehicleId}/photo.webp`, 500)], hasMore: false },
    ]);

    const library = await readPhotoLibrary();
    const byPath = new Map(library.entries.map((entry) => [entry.pathname, entry]));

    expect(byPath.get(`vehicles/${vehicleId}/in-use.webp`)?.state).toBe("linked");
    expect(byPath.get(`vehicles/${vehicleId}/replaced.webp`)?.state).toBe("unlinked");
    expect(byPath.get(`vehicles/${otherVehicleId}/deleted-vehicle.webp`)?.state).toBe("unlinked");
    expect(byPath.get(`staging/vehicles/${vehicleId}/photo.webp`)?.state).toBe("staging");
    expect(library.totals).toMatchObject({
      objects: 4,
      bytes: 1550,
      linked: 1,
      unlinked: 2,
      unlinkedBytes: 650,
      staging: 1,
      stagingBytes: 500,
    });
  });

  it("carries vehicle context onto an unlinked object that still names a known vehicle", async () => {
    store.vehicles = [vehicle(vehicleId, [])];
    store.pages.set("vehicles/", [
      { blobs: [blob(`vehicles/${vehicleId}/replaced.webp`, 350)], hasMore: false },
    ]);

    const [entry] = (await readPhotoLibrary()).entries;

    expect(entry).toMatchObject({
      state: "unlinked",
      vehicleId,
      vehicleTitle: "2019 Honda Civic EX",
      vehicleStatus: "published",
    });
  });

  it("reports a photograph the inventory references but the store no longer holds", async () => {
    store.vehicles = [vehicle(vehicleId, [photo(`vehicles/${vehicleId}/gone.webp`)])];

    const library = await readPhotoLibrary();

    expect(library.entries).toHaveLength(0);
    expect(library.missing).toEqual([
      {
        pathname: `vehicles/${vehicleId}/gone.webp`,
        url: `https://store.public.blob.vercel-storage.com/vehicles/${vehicleId}/gone.webp`,
        vehicleId,
        vehicleTitle: "2019 Honda Civic EX",
        vehicleStatus: "published",
      },
    ]);
  });

  it("never enumerates outside the photograph and staging prefixes", async () => {
    await readPhotoLibrary();

    expect(store.listCalls.map((call) => call.prefix).sort()).toEqual([
      "staging/vehicles/",
      "vehicles/",
    ]);
    const stagingCall = store.listCalls.find((call) => call.prefix === "staging/vehicles/");
    expect(stagingCall?.token).toBe("private-token");
    expect(store.listCalls.find((call) => call.prefix === "vehicles/")?.token).toBe("photo-token");
  });

  it("follows pagination and reports when the listing is still incomplete", async () => {
    store.pages.set("vehicles/", [
      { blobs: [blob(`vehicles/${vehicleId}/one.webp`, 100)], cursor: "1", hasMore: true },
      { blobs: [blob(`vehicles/${vehicleId}/two.webp`, 100)], hasMore: false },
    ]);

    const library = await readPhotoLibrary();

    expect(library.entries).toHaveLength(2);
    expect(library.truncated).toBe(false);
  });
});

describe("orphaned photograph deletion", () => {
  beforeEach(() => {
    store.vehicles = [vehicle(vehicleId, [photo(`vehicles/${vehicleId}/in-use.webp`)])];
    store.pages.set("vehicles/", [
      {
        blobs: [
          blob(`vehicles/${vehicleId}/in-use.webp`, 400),
          blob(`vehicles/${vehicleId}/replaced.webp`, 350),
        ],
        hasMore: false,
      },
    ]);
    store.pages.set("staging/vehicles/", [
      { blobs: [blob(`staging/vehicles/${vehicleId}/photo.webp`, 500)], hasMore: false },
    ]);
  });

  it("removes an unlinked photograph with the public photo credential", async () => {
    const removed = await deleteOrphanedPhoto(`vehicles/${vehicleId}/replaced.webp`);

    expect(removed.state).toBe("unlinked");
    expect(store.deleted).toEqual([
      {
        url: `https://store.public.blob.vercel-storage.com/vehicles/${vehicleId}/replaced.webp`,
        token: "photo-token",
      },
    ]);
  });

  it("removes a staging leftover with the private credential", async () => {
    const removed = await deleteOrphanedPhoto(`staging/vehicles/${vehicleId}/photo.webp`);

    expect(removed.state).toBe("staging");
    expect(store.deleted[0]?.token).toBe("private-token");
  });

  it("refuses to delete a photograph a vehicle still uses", async () => {
    await expect(deleteOrphanedPhoto(`vehicles/${vehicleId}/in-use.webp`)).rejects.toBeInstanceOf(
      PhotoLibraryDeletionError,
    );
    expect(store.deleted).toHaveLength(0);
  });

  it.each([
    ["an audit snapshot", "audit/vehicles/x/2026-08-20.json"],
    ["a path traversal attempt", "../security/auth/state-v1.json"],
    ["an unknown object", `vehicles/${vehicleId}/never-existed.webp`],
  ])("refuses %s that the library does not list", async (_name, pathname) => {
    await expect(deleteOrphanedPhoto(pathname)).rejects.toBeInstanceOf(PhotoLibraryDeletionError);
    expect(store.deleted).toHaveLength(0);
  });
});
