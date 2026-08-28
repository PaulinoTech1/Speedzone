import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  blobBody: null as string | null,
  blobEtag: null as string | null,
  blobContentType: "application/json",
  blobReportedSize: null as number | null,
  etagSequence: 0,
  globalInventory: null as unknown,
  conditionalWrites: 0,
  createConflictWriter: undefined as (() => void) | undefined,
  conflictWriter: undefined as (() => void) | undefined,
  repeatConflict: false,
}));

vi.mock("@vercel/blob", () => {
  class BlobPreconditionFailedError extends Error {}

  async function bodyText(body: unknown): Promise<string> {
    if (typeof body === "string") return body;
    if (body instanceof Blob) return body.text();
    if (body instanceof Uint8Array) return new TextDecoder().decode(body);
    return String(body);
  }

  return {
    BlobPreconditionFailedError,
    get: vi.fn(async (pathname: string) => {
      if (!storage.blobBody || !storage.blobEtag) return null;
      return {
        statusCode: 200 as const,
        stream: new Response(storage.blobBody).body!,
        headers: new Headers(),
        blob: {
          url: `https://private.example/${pathname}`,
          downloadUrl: `https://private.example/${pathname}?download=1`,
          pathname,
          contentDisposition: "attachment",
          cacheControl: "private, no-store",
          uploadedAt: new Date(0),
          etag: storage.blobEtag,
          contentType: storage.blobContentType,
          size:
            storage.blobReportedSize ?? new TextEncoder().encode(storage.blobBody).byteLength,
        },
      };
    }),
    put: vi.fn(
      async (
        pathname: string,
        body: unknown,
        options: { allowOverwrite?: boolean; ifMatch?: string },
      ) => {
        if (!options.allowOverwrite && storage.createConflictWriter) {
          const writer = storage.createConflictWriter;
          storage.createConflictWriter = undefined;
          writer();
          throw new BlobPreconditionFailedError();
        }
        if (!options.allowOverwrite && storage.blobBody) {
          throw new BlobPreconditionFailedError();
        }
        if (options.ifMatch) {
          storage.conditionalWrites += 1;
          if (storage.conflictWriter) {
            const writer = storage.conflictWriter;
            if (!storage.repeatConflict) storage.conflictWriter = undefined;
            writer();
            throw new BlobPreconditionFailedError();
          }
          if (options.ifMatch !== storage.blobEtag) {
            throw new BlobPreconditionFailedError();
          }
        }

        storage.blobBody = await bodyText(body);
        storage.blobEtag = `etag-${++storage.etagSequence}`;
        return {
          url: `https://private.example/${pathname}`,
          downloadUrl: `https://private.example/${pathname}?download=1`,
          pathname,
          contentType: "application/json",
          contentDisposition: "attachment",
          etag: storage.blobEtag,
        };
      },
    ),
  };
});

vi.mock("@vercel/global-config", () => ({
  createClient: vi.fn(() => ({
    get: vi.fn(async () => storage.globalInventory),
  })),
}));

import { get, put } from "@vercel/blob";
import { createClient } from "@vercel/global-config";

import {
  emptyInventoryState,
  type InventoryState,
  type VehicleRecord,
} from "@/lib/domain/vehicle";
import {
  mutateInventoryState,
  readInventoryState,
  StateConfigurationError,
  StateConflictError,
} from "@/lib/server/storage/state";

const inventoryBlobPath = "inventory/state-v1.json";
const credentialEnvironment = [
  "BLOB_INVENTORY_READ_WRITE_TOKEN",
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_INVENTORY_STORE_ID",
  "BLOB_STORE_ID",
  "VERCEL_OIDC_TOKEN",
] as const;

function vehicle(sequence: 1 | 2): VehicleRecord {
  return {
    id: `00000000-0000-4000-8000-00000000000${sequence}`,
    version: 1,
    stockNumber: `SZ-${sequence}`,
    vin: sequence === 1 ? "1HGCM82633A004352" : "2HGFG12698H304821",
    year: 2020 + sequence,
    make: sequence === 1 ? "Honda" : "Toyota",
    model: sequence === 1 ? "Civic" : "Corolla",
    trim: "LE",
    price: 15_000 + sequence,
    mileage: 50_000 + sequence,
    exteriorColor: "Black",
    interiorColor: "Black",
    bodyStyle: "Sedan",
    transmission: "Automatic",
    drivetrain: "FWD",
    fuelType: "Gasoline",
    engine: "2.0L",
    description: "Inventory storage fixture",
    features: [],
    status: "draft",
    slug: sequence === 1 ? "fixture-honda-civic" : "fixture-toyota-corolla",
    photographs: [],
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  };
}

function inventoryState(
  revision: number,
  vehicles: VehicleRecord[] = [],
): InventoryState {
  return { schemaVersion: 1, revision, vehicles };
}

function installBlob(state: InventoryState): void {
  storage.blobBody = `${JSON.stringify(state)}\n`;
  storage.blobEtag = `etag-${++storage.etagSequence}`;
}

function storedInventoryState(): InventoryState {
  if (!storage.blobBody) throw new Error("Expected a simulated inventory Blob");
  return JSON.parse(storage.blobBody) as InventoryState;
}

function stubCredentials(
  values: Partial<Record<(typeof credentialEnvironment)[number], string>>,
): void {
  for (const name of credentialEnvironment) vi.stubEnv(name, values[name] ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  storage.blobBody = null;
  storage.blobEtag = null;
  storage.blobContentType = "application/json";
  storage.blobReportedSize = null;
  storage.etagSequence = 0;
  storage.globalInventory = null;
  storage.conditionalWrites = 0;
  storage.createConflictWriter = undefined;
  storage.conflictWriter = undefined;
  storage.repeatConflict = false;

  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("INVENTORY_GLOBAL_CONFIG", "");
  vi.stubEnv("INVENTORY_GLOBAL_CONFIG_ID", "");
  stubCredentials({ BLOB_INVENTORY_READ_WRITE_TOKEN: "inventory-token" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authoritative inventory Blob storage", () => {
  it("reads the deterministic private pathname without the Blob CDN cache", async () => {
    const current = inventoryState(3, [vehicle(1)]);
    installBlob(current);

    await expect(readInventoryState()).resolves.toEqual(current);
    expect(vi.mocked(get)).toHaveBeenCalledOnce();
    expect(vi.mocked(get)).toHaveBeenCalledWith(
      inventoryBlobPath,
      expect.objectContaining({
        access: "private",
        useCache: false,
        token: "inventory-token",
      }),
    );
  });

  it("atomically seeds the first Blob from legacy Inventory Global Config", async () => {
    const legacy = inventoryState(7, [vehicle(1)]);
    storage.globalInventory = legacy;
    vi.stubEnv("INVENTORY_GLOBAL_CONFIG", "https://global-config.example/read-token");

    await expect(readInventoryState()).resolves.toEqual(legacy);
    expect(vi.mocked(createClient)).toHaveBeenCalledWith(
      "https://global-config.example/read-token",
    );
    expect(vi.mocked(put)).toHaveBeenCalledWith(
      inventoryBlobPath,
      expect.anything(),
      expect.objectContaining({
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json",
        token: "inventory-token",
      }),
    );
    expect(storedInventoryState()).toEqual(legacy);

    storage.globalInventory = emptyInventoryState();
    await expect(readInventoryState()).resolves.toEqual(legacy);
  });

  it("seeds an empty state when no legacy Inventory Global Config exists", async () => {
    await expect(readInventoryState()).resolves.toEqual(emptyInventoryState());
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
    expect(storedInventoryState()).toEqual(emptyInventoryState());
  });

  it("uses the winner of a concurrent first-write race instead of overwriting it", async () => {
    const winner = inventoryState(1, [vehicle(1)]);
    storage.createConflictWriter = () => installBlob(winner);

    await expect(readInventoryState()).resolves.toEqual(winner);
    const createOptions = vi.mocked(put).mock.calls[0]?.[2];
    expect(createOptions).toEqual(
      expect.objectContaining({ allowOverwrite: false, addRandomSuffix: false }),
    );
    expect(storedInventoryState()).toEqual(winner);
  });

  it("rebases a bounded ETag retry on the latest inventory state", async () => {
    installBlob(inventoryState(0));
    storage.conflictWriter = () => installBlob(inventoryState(1, [vehicle(1)]));

    const result = await mutateInventoryState((current) => ({
      ...current,
      vehicles: [...current.vehicles, vehicle(2)],
    }));

    expect(result).toEqual(inventoryState(2, [vehicle(1), vehicle(2)]));
    expect(storedInventoryState()).toEqual(result);
    expect(storage.conditionalWrites).toBe(2);
    const conditionalOptions = vi
      .mocked(put)
      .mock.calls.map((call) => call[2])
      .filter((options) => options.ifMatch);
    expect(conditionalOptions).toEqual([
      expect.objectContaining({ allowOverwrite: true, ifMatch: "etag-1" }),
      expect.objectContaining({ allowOverwrite: true, ifMatch: "etag-2" }),
    ]);
  });

  it("rejects a stale expected revision without overwriting the concurrent winner", async () => {
    installBlob(inventoryState(0));
    const concurrent = inventoryState(1, [vehicle(1)]);
    storage.conflictWriter = () => installBlob(concurrent);

    await expect(
      mutateInventoryState(
        (current) => ({ ...current, vehicles: [...current.vehicles, vehicle(2)] }),
        0,
      ),
    ).rejects.toBeInstanceOf(StateConflictError);

    expect(storage.conditionalWrites).toBe(1);
    expect(storedInventoryState()).toEqual(concurrent);
  });

  it("bounds repeated ETag conflicts", async () => {
    installBlob(inventoryState(0));
    storage.repeatConflict = true;
    storage.conflictWriter = () => {
      const current = storedInventoryState();
      installBlob({ ...current, revision: current.revision + 1 });
    };

    await expect(
      mutateInventoryState((current) => current),
    ).rejects.toBeInstanceOf(StateConflictError);
    expect(storage.conditionalWrites).toBe(5);
  });

  it("fails closed in production when no complete Blob credentials exist", async () => {
    stubCredentials({});

    await expect(readInventoryState()).rejects.toBeInstanceOf(StateConfigurationError);
    expect(vi.mocked(get)).not.toHaveBeenCalled();
    expect(vi.mocked(put)).not.toHaveBeenCalled();
  });

  it.each([
    [
      "malformed JSON",
      () => {
        storage.blobBody = "{not-json";
      },
    ],
    [
      "a non-JSON content type",
      () => {
        storage.blobContentType = "text/plain";
      },
    ],
    [
      "an oversized object",
      () => {
        storage.blobReportedSize = 32 * 1024 * 1024 + 1;
      },
    ],
  ])("rejects %s from authoritative storage", async (_name, corrupt) => {
    installBlob(emptyInventoryState());
    corrupt();

    await expect(readInventoryState()).rejects.toBeInstanceOf(StateConfigurationError);
  });

  it.each([
    {
      name: "the dedicated inventory read-write token",
      environment: { BLOB_INVENTORY_READ_WRITE_TOKEN: "inventory-token" },
      expected: { token: "inventory-token" },
    },
    {
      name: "the Vercel default read-write token",
      environment: { BLOB_READ_WRITE_TOKEN: "default-token" },
      expected: { token: "default-token" },
    },
    {
      name: "OIDC with the dedicated inventory store id",
      environment: {
        BLOB_INVENTORY_STORE_ID: "store_inventory",
        VERCEL_OIDC_TOKEN: "oidc-token",
      },
      expected: { storeId: "store_inventory", oidcToken: "oidc-token" },
    },
    {
      name: "OIDC with the Vercel default store id",
      environment: {
        BLOB_STORE_ID: "store_default",
        VERCEL_OIDC_TOKEN: "oidc-token",
      },
      expected: { storeId: "store_default", oidcToken: "oidc-token" },
    },
    {
      name: "dedicated OIDC in preference to the dedicated static token",
      environment: {
        BLOB_INVENTORY_READ_WRITE_TOKEN: "inventory-token",
        BLOB_INVENTORY_STORE_ID: "store_inventory",
        VERCEL_OIDC_TOKEN: "oidc-token",
      },
      expected: { storeId: "store_inventory", oidcToken: "oidc-token" },
    },
    {
      name: "default OIDC in preference to the default static token",
      environment: {
        BLOB_READ_WRITE_TOKEN: "default-token",
        BLOB_STORE_ID: "store_default",
        VERCEL_OIDC_TOKEN: "oidc-token",
      },
      expected: { storeId: "store_default", oidcToken: "oidc-token" },
    },
  ])("supports $name", async ({ environment, expected }) => {
    stubCredentials(environment);
    installBlob(inventoryState(2));

    await expect(readInventoryState()).resolves.toEqual(inventoryState(2));
    const options = vi.mocked(get).mock.calls[0]?.[1];
    expect(options).toEqual(
      expect.objectContaining({
        access: "private",
        useCache: false,
        ...expected,
      }),
    );
    if ("oidcToken" in expected) expect(options).not.toHaveProperty("token");
  });
});
