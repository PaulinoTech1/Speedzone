import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/storage/audit", () => ({
  writeVehicleAuditSnapshot: vi.fn(async () => "test-audit.json"),
}));

import {
  createVehicle,
  InventoryValidationError,
  listAllVehicles,
  listPublishedVehicles,
  updateVehicle,
} from "@/lib/server/inventory";
import { writeVehicleAuditSnapshot } from "@/lib/server/storage/audit";

let testDirectory = "";

function vehicle(overrides: Record<string, unknown> = {}) {
  return {
    stockNumber: "SZ-200",
    vin: "1HGCM82633A004352",
    year: 2020,
    make: "Honda",
    model: "Civic",
    trim: "LX",
    price: 14900,
    mileage: 61000,
    exteriorColor: "Blue",
    interiorColor: "Black",
    bodyStyle: "Sedan",
    transmission: "Automatic",
    drivetrain: "FWD",
    fuelType: "Gasoline",
    engine: "2.0L",
    description: "Plain text",
    features: ["Backup camera"],
    status: "draft",
    slug: "2020-honda-civic",
    photographs: [],
    ...overrides,
  };
}

function photo() {
  return {
    url: "https://fixture.public.blob.vercel-storage.com/vehicles/test/photo.webp",
    pathname: "vehicles/test/photo.webp",
    width: 1200,
    height: 800,
    bytes: 120_000,
    alt: "Honda Civic",
    createdAt: new Date().toISOString(),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  testDirectory = await mkdtemp(join(tmpdir(), "speedzone-inventory-"));
  process.env.LOCAL_STATE_PATH = join(testDirectory, "state.json");
});

afterEach(async () => {
  delete process.env.LOCAL_STATE_PATH;
  await rm(testDirectory, { recursive: true, force: true });
});

describe("inventory persistence rules", () => {
  it.each([
    ["stockNumber", "sz-200", "DUPLICATE_STOCK"],
    ["vin", "1HGCM82633A004352", "DUPLICATE_VIN"],
    ["slug", "2020-honda-civic", "DUPLICATE_SLUG"],
  ])("rejects duplicate %s", async (field, duplicate, code) => {
    await createVehicle(vehicle());
    await expect(
      createVehicle(
        vehicle({
          stockNumber: "SZ-201",
          vin: "2HGFG12698H304821",
          slug: "different-car",
          [field]: duplicate,
        }),
      ),
    ).rejects.toMatchObject({ code } satisfies Partial<InventoryValidationError>);
  });

  it("enforces optimistic versions and status transitions", async () => {
    const created = await createVehicle(vehicle());
    await expect(
      updateVehicle(created.id, vehicle({ expectedVersion: 99 })),
    ).rejects.toThrow(/changed/);
    await expect(
      updateVehicle(created.id, vehicle({ expectedVersion: 1, status: "sold" })),
    ).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    } satisfies Partial<InventoryValidationError>);
  });

  it("persists the complete draft, publish, sold, archive, and restore lifecycle", async () => {
    const draft = await createVehicle(vehicle());
    expect(draft).toMatchObject({ status: "draft", version: 1 });

    const published = await updateVehicle(
      draft.id,
      vehicle({ expectedVersion: draft.version, status: "published", photographs: [photo()] }),
    );
    expect(published).toMatchObject({ status: "published", version: 2 });
    await expect(listPublishedVehicles()).resolves.toMatchObject([{ id: draft.id }]);

    const sold = await updateVehicle(
      draft.id,
      vehicle({ expectedVersion: published.version, status: "sold", photographs: [photo()] }),
    );
    expect(sold).toMatchObject({ status: "sold", version: 3 });
    await expect(listPublishedVehicles()).resolves.toEqual([]);

    const archived = await updateVehicle(
      draft.id,
      vehicle({ expectedVersion: sold.version, status: "archived", photographs: [photo()] }),
    );
    expect(archived).toMatchObject({ status: "archived", version: 4 });

    const restored = await updateVehicle(
      draft.id,
      vehicle({ expectedVersion: archived.version, status: "draft", photographs: [photo()] }),
    );
    expect(restored).toMatchObject({ status: "draft", version: 5 });
    await expect(listAllVehicles()).resolves.toMatchObject({
      revision: 5,
      vehicles: [{ id: draft.id, status: "draft", version: 5 }],
    });

    expect(
      vi.mocked(writeVehicleAuditSnapshot).mock.calls.map(([entry]) => entry.action),
    ).toEqual(["create", "publish", "sold", "archive", "restore"]);
  });

  it("stores hostile listing copy only as plain text data", async () => {
    const payload = `</script><script>globalThis.compromised=true</script><img src=x onerror=alert(1)>`;
    const created = await createVehicle(
      vehicle({ description: payload, features: [payload] }),
    );
    const persisted = (await listAllVehicles()).vehicles[0];
    expect(created.description).toBe(payload);
    expect(persisted?.description).toBe(payload);
    expect(persisted?.features).toEqual([payload]);
  });
});
