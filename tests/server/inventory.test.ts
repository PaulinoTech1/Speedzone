import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StoredDoc = Record<string, unknown> & { _id: string; _type: string; _rev: string };

const store = vi.hoisted(() => ({
  docs: new Map<string, StoredDoc>(),
  // One-shot override consumed by the next getDocument() call only, so a test
  // can simulate a reader whose snapshot predates a since-committed write.
  forcedGetDocument: undefined as StoredDoc | null | undefined,
}));

vi.mock("@sanity/client", () => {
  class ClientError extends Error {
    constructor(
      readonly statusCode: number,
      message: string,
    ) {
      super(message);
    }
  }

  type Operation =
    | { kind: "create"; doc: StoredDoc }
    | { kind: "patch"; id: string; set: Record<string, unknown>; ifRevisionId?: string }
    | { kind: "delete"; id: string };

  function transaction() {
    const ops: Operation[] = [];
    const tx = {
      create(doc: StoredDoc) {
        ops.push({ kind: "create", doc });
        return tx;
      },
      patch(id: string, builder: unknown) {
        const patchBuilder = {
          _set: {} as Record<string, unknown>,
          _rev: undefined as string | undefined,
          set(attrs: Record<string, unknown>) {
            this._set = attrs;
            return this;
          },
          ifRevisionId(rev: string) {
            this._rev = rev;
            return this;
          },
        };
        const built =
          typeof builder === "function"
            ? (builder as (p: typeof patchBuilder) => typeof patchBuilder)(patchBuilder)
            : patchBuilder;
        ops.push({ kind: "patch", id, set: built._set, ifRevisionId: built._rev });
        return tx;
      },
      delete(id: string) {
        ops.push({ kind: "delete", id });
        return tx;
      },
      async commit() {
        // Atomicity: validate every operation before applying any of them.
        for (const op of ops) {
          if (op.kind === "create" && store.docs.has(op.doc._id)) {
            throw new ClientError(409, `Document with ID "${op.doc._id}" already exists`);
          }
          if (op.kind === "patch" && op.ifRevisionId !== undefined) {
            const current = store.docs.get(op.id);
            if (!current || current._rev !== op.ifRevisionId) {
              throw new ClientError(409, "The document has been changed by a third party");
            }
          }
        }
        for (const op of ops) {
          if (op.kind === "create") {
            store.docs.set(op.doc._id, { ...op.doc, _rev: randomUUID() });
          } else if (op.kind === "patch") {
            const current = store.docs.get(op.id);
            if (current) store.docs.set(op.id, { ...current, ...op.set, _rev: randomUUID() });
          } else {
            store.docs.delete(op.id);
          }
        }
        return { results: [] };
      },
    };
    return tx;
  }

  function fetchImpl(query: string, params: Record<string, unknown> = {}) {
    const normalized = query.replace(/\s+/g, " ").trim();
    if (normalized.includes("lower(stockNumber)") && normalized.includes("$excludeVehicleId")) {
      return Promise.resolve(
        [...store.docs.values()]
          .filter(
            (doc) =>
              doc._type === "vehicle" &&
              doc._id !== params.excludeVehicleId &&
              ["stockNumber", "vin", "slug"].some(
                (field) =>
                  String(doc[field]).toLowerCase() === String(params[field]).toLowerCase(),
              ),
          )
          .map((doc) => ({
            _id: doc._id,
            stockNumber: doc.stockNumber,
            vin: doc.vin,
            slug: doc.slug,
          })),
      );
    }
    if (normalized.includes("_id == $id") && normalized.endsWith("}")) {
      if (store.forcedGetDocument !== undefined) {
        const forced = store.forcedGetDocument;
        store.forcedGetDocument = undefined;
        return Promise.resolve(forced ?? null);
      }
      return Promise.resolve(store.docs.get(String(params.id)) ?? null);
    }
    if (normalized.includes('status == "published" && slug == $slug][0]')) {
      const match = [...store.docs.values()].find(
        (doc) => doc._type === "vehicle" && doc.status === "published" && doc.slug === params.slug,
      );
      return Promise.resolve(match ?? null);
    }
    if (normalized.includes('status == "published"]') && normalized.includes("| order")) {
      return Promise.resolve(
        [...store.docs.values()]
          .filter((doc) => doc._type === "vehicle" && doc.status === "published")
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      );
    }
    if (normalized.startsWith('*[_type == "vehicle"') && normalized.includes("| order")) {
      return Promise.resolve(
        [...store.docs.values()]
          .filter((doc) => doc._type === "vehicle")
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      );
    }
    if (normalized.startsWith("*[_id in $ids]")) {
      const ids = params.ids as string[];
      return Promise.resolve(
        [...store.docs.values()]
          .filter((doc) => ids.includes(doc._id))
          .map((doc) => ({ _id: doc._id, vehicleId: doc.vehicleId })),
      );
    }
    return Promise.reject(new Error(`Unexpected GROQ query in test fixture: ${query}`));
  }

  return {
    ClientError,
    createClient: vi.fn(() => ({
      fetch: vi.fn(fetchImpl),
      getDocument: vi.fn((id: string) => {
        if (store.forcedGetDocument !== undefined) {
          const forced = store.forcedGetDocument;
          store.forcedGetDocument = undefined;
          return Promise.resolve(forced ?? undefined);
        }
        return Promise.resolve(store.docs.get(id));
      }),
      transaction: vi.fn(transaction),
      assets: { upload: vi.fn() },
    })),
  };
});

import { InventoryValidationError, createVehicle, listAllVehicles, listPublishedVehicles, updateVehicle } from "@/lib/server/inventory";
import { StateConflictError } from "@/lib/server/storage/errors";

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
    url: "https://cdn.sanity.io/images/fixture/production/abc-1200x800.webp",
    pathname: "image-abc123-1200x800-webp",
    width: 1200,
    height: 800,
    bytes: 120_000,
    alt: "Honda Civic",
    createdAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  store.docs.clear();
  store.forcedGetDocument = undefined;
  vi.stubEnv("SANITY_PROJECT_ID", "fixture");
  vi.stubEnv("SANITY_DATASET", "test");
  vi.stubEnv("SANITY_API_TOKEN", "fixture-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("inventory persistence rules", () => {
  it("allows multiple vehicles without VINs while retaining stock and slug uniqueness", async () => {
    const first = await createVehicle(vehicle({ stockNumber: "10841", vin: "", slug: "2013-honda-civic-10841" }));
    const second = await createVehicle(vehicle({ stockNumber: "10842", vin: "", slug: "2013-honda-civic-10842" }));

    expect(first.vin).toBe("");
    expect(second.vin).toBe("");
    expect([...store.docs.values()].filter((doc) => doc._type === "vehicleLock" && doc.field === "vin")).toHaveLength(0);
  });

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
      vehicles: [{ id: draft.id, status: "draft", version: 5 }],
    });
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

  it("rejects a lock collision introduced by an update, not just at create time", async () => {
    await createVehicle(vehicle());
    const other = await createVehicle(
      vehicle({ stockNumber: "SZ-201", vin: "2HGFG12698H304821", slug: "different-car" }),
    );
    // Only the VIN collides — stockNumber/slug stay at `other`'s own current
    // values, so this isolates the VIN check from the other two unique fields.
    await expect(
      updateVehicle(
        other.id,
        vehicle({
          expectedVersion: other.version,
          stockNumber: other.stockNumber,
          slug: other.slug,
          vin: "1HGCM82633A004352",
        }),
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_VIN" } satisfies Partial<InventoryValidationError>);
    // The failed transaction must not have touched the target document.
    await expect(listAllVehicles()).resolves.toMatchObject({
      vehicles: expect.arrayContaining([expect.objectContaining({ id: other.id, version: 1 })]),
    });
  });

  it("releases the old slug lock and claims the new one on a same-vehicle edit, without disturbing untouched locks", async () => {
    const created = await createVehicle(vehicle());
    const renamed = await updateVehicle(
      created.id,
      vehicle({ expectedVersion: created.version, slug: "renamed-honda-civic" }),
    );
    expect(renamed.slug).toBe("renamed-honda-civic");

    // A new vehicle can now reuse the released slug...
    const reused = await createVehicle(
      vehicle({ stockNumber: "SZ-202", vin: "3HGFG12698H304822", slug: "2020-honda-civic" }),
    );
    expect(reused.slug).toBe("2020-honda-civic");

    // ...while the untouched stockNumber/VIN locks still protect the original vehicle.
    await expect(
      createVehicle(vehicle({ slug: "yet-another-slug" })),
    ).rejects.toMatchObject({ code: "DUPLICATE_STOCK" } satisfies Partial<InventoryValidationError>);
  });

  it("surfaces a conflict rather than a duplicate code when the revision truly moved", async () => {
    const created = await createVehicle(vehicle());
    const staleSnapshot = store.docs.get(created.id);

    // A second writer commits a real, unrelated change first...
    await updateVehicle(created.id, vehicle({ expectedVersion: created.version, price: 20000 }));

    // ...then this caller's own read is forced back to the pre-race snapshot,
    // simulating a reader whose getDocument() happened before that commit.
    // Only the *next* getDocument() call is overridden, so the re-read inside
    // updateVehicle's own conflict handling still sees the true, current state.
    store.forcedGetDocument = staleSnapshot ?? null;

    await expect(
      updateVehicle(created.id, vehicle({ expectedVersion: created.version, price: 15900 })),
    ).rejects.toBeInstanceOf(StateConflictError);
  });
});
