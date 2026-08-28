import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  canTransitionVehicle,
  vehicleInputSchema,
  vehicleRecordSchema,
  type InventoryState,
  type VehicleInput,
  type VehiclePhoto,
  type VehicleRecord,
  type VehicleStatus,
} from "@/lib/domain/vehicle";
import { StateConflictError } from "@/lib/server/storage/errors";
import { isConflict, sanity, translateSanityError } from "@/lib/server/storage/sanity";

export class InventoryValidationError extends Error {
  constructor(
    message: string,
    readonly code = "INVENTORY_INVALID",
  ) {
    super(message);
  }
}

type UniqueField = "stockNumber" | "vin" | "slug";
const uniqueFields: readonly UniqueField[] = ["stockNumber", "vin", "slug"];

const duplicateCode: Record<UniqueField, string> = {
  stockNumber: "DUPLICATE_STOCK",
  vin: "DUPLICATE_VIN",
  slug: "DUPLICATE_SLUG",
};
const duplicateMessage: Record<UniqueField, string> = {
  stockNumber: "Stock number is already in use",
  vin: "VIN is already in use",
  slug: "URL slug is already in use",
};

/**
 * Deterministic ID for a `vehicleLock` document, hashed rather than embedding
 * the raw value: `stockNumber` permits `.`/`_`/`-`, and Sanity document-ID
 * character rules for arbitrary values can't be assumed. The unique fields are
 * already Zod-normalized (case-transformed) before this ever runs, so the
 * existing case-insensitive uniqueness requirement holds for free.
 */
function lockId(field: UniqueField, normalizedValue: string): string {
  const digest = createHash("sha256")
    .update(`${field}:${normalizedValue}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `vehicleLock-${field}-${digest}`;
}

type SanityPhoto = {
  _key: string;
  _type: "image";
  asset: { _type: "reference"; _ref: string };
  url: string;
  pathname: string;
  width: number;
  height: number;
  bytes: number;
  alt: string;
  createdAt: string;
};

type VehicleFields = {
  version: number;
  createdAt: string;
  updatedAt: string;
  stockNumber: string;
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  price: number;
  mileage: number;
  exteriorColor: string;
  interiorColor: string;
  bodyStyle: string;
  transmission: string;
  drivetrain: string;
  fuelType: string;
  engine: string;
  description: string;
  features: string[];
  status: VehicleStatus;
  slug: string;
  photographs: SanityPhoto[];
};

type VehicleDocument = VehicleFields & { _id: string; _rev: string };
type LockDocument = { _id: string; vehicleId: string };

function toVehiclePhoto(photo: SanityPhoto): VehiclePhoto {
  return {
    url: photo.url,
    pathname: photo.pathname,
    width: photo.width,
    height: photo.height,
    bytes: photo.bytes,
    alt: photo.alt,
    createdAt: photo.createdAt,
  };
}

/** `pathname` holds the Sanity asset `_id` — repurposed, not a Blob path any more. */
function toSanityPhoto(photo: VehiclePhoto): SanityPhoto {
  return {
    _key: randomUUID(),
    _type: "image",
    asset: { _type: "reference", _ref: photo.pathname },
    url: photo.url,
    pathname: photo.pathname,
    width: photo.width,
    height: photo.height,
    bytes: photo.bytes,
    alt: photo.alt,
    createdAt: photo.createdAt,
  };
}

/** Re-validates every document through the same Zod schema the API routes use. */
function toVehicleRecord(doc: VehicleDocument): VehicleRecord {
  return vehicleRecordSchema.parse({
    id: doc._id,
    version: doc.version,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    stockNumber: doc.stockNumber,
    vin: doc.vin,
    year: doc.year,
    make: doc.make,
    model: doc.model,
    trim: doc.trim,
    price: doc.price,
    mileage: doc.mileage,
    exteriorColor: doc.exteriorColor,
    interiorColor: doc.interiorColor,
    bodyStyle: doc.bodyStyle,
    transmission: doc.transmission,
    drivetrain: doc.drivetrain,
    fuelType: doc.fuelType,
    engine: doc.engine,
    description: doc.description,
    features: doc.features,
    status: doc.status,
    slug: doc.slug,
    photographs: (doc.photographs ?? []).map(toVehiclePhoto),
  });
}

function toSanityVehicleFields(vehicle: VehicleRecord): VehicleFields {
  const { id: _id, photographs, ...fields } = vehicle;
  void _id;
  return { ...fields, photographs: photographs.map(toSanityPhoto) };
}

/**
 * Skip-and-log a single malformed document rather than fail the whole list —
 * a deliberate improvement now that vehicles are independent documents instead
 * of one all-or-nothing JSON blob.
 */
function mapVehicles(docs: VehicleDocument[]): VehicleRecord[] {
  const vehicles: VehicleRecord[] = [];
  for (const doc of docs) {
    try {
      vehicles.push(toVehicleRecord(doc));
    } catch (error) {
      console.error(`Skipping malformed vehicle document ${doc._id}:`, error);
    }
  }
  return vehicles;
}

/**
 * Fast, friendly pre-check before building a transaction. The atomic guard is
 * the lock documents' `create()` inside the transaction itself (see
 * `createVehicle`/`updateVehicle`) — this call only produces a nicer error
 * before doing any writes, and is re-run after a 409 to recover which specific
 * field collided.
 */
async function assertUniquePrecheck(
  input: Pick<VehicleInput, UniqueField>,
  excludeVehicleId?: string,
): Promise<void> {
  const ids: Record<UniqueField, string> = {
    stockNumber: lockId("stockNumber", input.stockNumber),
    vin: lockId("vin", input.vin),
    slug: lockId("slug", input.slug),
  };
  let docs: LockDocument[];
  try {
    docs = await sanity().fetch<LockDocument[]>(`*[_id in $ids]{_id, vehicleId}`, {
      ids: Object.values(ids),
    });
  } catch (error) {
    throw translateSanityError(error);
  }
  for (const field of uniqueFields) {
    const hit = docs.find((doc) => doc._id === ids[field]);
    if (hit && hit.vehicleId !== excludeVehicleId) {
      throw new InventoryValidationError(duplicateMessage[field], duplicateCode[field]);
    }
  }
}

export async function listAllVehicles(): Promise<InventoryState> {
  let docs: VehicleDocument[];
  try {
    docs = await sanity().fetch<VehicleDocument[]>(`*[_type == "vehicle"] | order(updatedAt desc)`);
  } catch (error) {
    throw translateSanityError(error);
  }
  const vehicles = mapVehicles(docs);
  return {
    schemaVersion: 1,
    // No single dataset-wide mutation counter exists once each vehicle is its
    // own document; this is display-only today (never used for correctness).
    revision: vehicles.reduce((sum, vehicle) => sum + vehicle.version, 0),
    vehicles,
  };
}

export async function listPublishedVehicles(): Promise<VehicleRecord[]> {
  let docs: VehicleDocument[];
  try {
    docs = await sanity().fetch<VehicleDocument[]>(
      `*[_type == "vehicle" && status == "published"] | order(updatedAt desc)`,
    );
  } catch (error) {
    throw translateSanityError(error);
  }
  return mapVehicles(docs);
}

export async function findPublishedVehicleBySlug(slug: string): Promise<VehicleRecord | null> {
  let doc: VehicleDocument | null;
  try {
    doc = await sanity().fetch<VehicleDocument | null>(
      `*[_type == "vehicle" && status == "published" && slug == $slug][0]`,
      { slug },
    );
  } catch (error) {
    throw translateSanityError(error);
  }
  if (!doc) return null;
  try {
    return toVehicleRecord(doc);
  } catch (error) {
    console.error(`Malformed vehicle document ${doc._id}:`, error);
    return null;
  }
}

export async function createVehicle(rawInput: unknown): Promise<VehicleRecord> {
  const input = vehicleInputSchema.parse(rawInput);
  await assertUniquePrecheck(input);

  const now = new Date().toISOString();
  const { expectedVersion: _expectedVersion, ...recordInput } = input;
  void _expectedVersion;
  const id = randomUUID();
  const vehicle: VehicleRecord = {
    ...recordInput,
    id,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  const client = sanity();
  const tx = client.transaction().create({
    _id: id,
    _type: "vehicle",
    ...toSanityVehicleFields(vehicle),
  });
  for (const field of uniqueFields) {
    tx.create({
      _id: lockId(field, vehicle[field]),
      _type: "vehicleLock",
      field,
      value: vehicle[field],
      vehicleId: id,
    });
  }

  try {
    await tx.commit();
  } catch (error) {
    if (isConflict(error)) {
      // The transaction is all-or-nothing, so nothing was written. The only
      // way a create() can fail here is a lock collision.
      await assertUniquePrecheck(input);
      throw new StateConflictError("Vehicle could not be created; retry the operation");
    }
    throw translateSanityError(error);
  }
  return vehicle;
}

export async function updateVehicle(id: string, rawInput: unknown): Promise<VehicleRecord> {
  const input = vehicleInputSchema.parse(rawInput);

  const client = sanity();
  let doc: VehicleDocument | undefined;
  try {
    doc = await client.getDocument<VehicleFields>(id);
  } catch (error) {
    throw translateSanityError(error);
  }
  if (!doc) throw new InventoryValidationError("Vehicle was not found", "NOT_FOUND");
  const revision = doc._rev;
  const before = toVehicleRecord(doc);

  if (input.expectedVersion !== before.version) {
    throw new StateConflictError("Vehicle changed; reload before saving");
  }
  if (!canTransitionVehicle(before.status, input.status)) {
    throw new InventoryValidationError(
      `Status cannot change from ${before.status} to ${input.status}`,
      "INVALID_STATUS_TRANSITION",
    );
  }
  await assertUniquePrecheck(input, id);

  const { expectedVersion: _expectedVersion, ...recordInput } = input;
  void _expectedVersion;
  const after: VehicleRecord = {
    ...recordInput,
    id,
    version: before.version + 1,
    createdAt: before.createdAt,
    updatedAt: new Date().toISOString(),
  };

  const tx = client.transaction().patch(id, (patch) =>
    patch.set(toSanityVehicleFields(after)).ifRevisionId(revision),
  );
  for (const field of uniqueFields) {
    const oldLockId = lockId(field, before[field]);
    const newLockId = lockId(field, after[field]);
    if (oldLockId !== newLockId) {
      tx.create({ _id: newLockId, _type: "vehicleLock", field, value: after[field], vehicleId: id });
      tx.delete(oldLockId);
    }
  }

  try {
    await tx.commit();
  } catch (error) {
    if (isConflict(error)) {
      // Re-read to tell a genuine concurrent edit apart from a lock collision:
      // the transaction is all-or-nothing, so exactly one of these happened.
      let latest: VehicleDocument | undefined;
      try {
        latest = await client.getDocument<VehicleFields>(id);
      } catch (readError) {
        throw translateSanityError(readError);
      }
      if (!latest || latest._rev !== revision) {
        throw new StateConflictError("Vehicle changed; reload before saving");
      }
      await assertUniquePrecheck(input, id);
      throw new StateConflictError("Vehicle changed; retry the operation");
    }
    throw translateSanityError(error);
  }
  return after;
}
