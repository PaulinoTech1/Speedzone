import "server-only";

import { randomUUID } from "node:crypto";

import {
  canTransitionVehicle,
  type InventoryState,
  type VehicleInput,
  type VehicleRecord,
  vehicleInputSchema,
} from "@/lib/domain/vehicle";
import { adminConfig } from "@/lib/server/env";
import {
  type VehicleAuditAction,
  writeVehicleAuditSnapshot,
} from "@/lib/server/storage/audit";
import {
  mutateInventoryState,
  readInventoryState,
  StateConflictError,
} from "@/lib/server/storage/state";

export class InventoryValidationError extends Error {
  constructor(
    message: string,
    readonly code = "INVENTORY_INVALID",
  ) {
    super(message);
  }
}

function assertUnique(state: InventoryState, input: VehicleInput, exceptId?: string): void {
  for (const vehicle of state.vehicles) {
    if (vehicle.id === exceptId) continue;
    if (vehicle.stockNumber.toLowerCase() === input.stockNumber.toLowerCase()) {
      throw new InventoryValidationError("Stock number is already in use", "DUPLICATE_STOCK");
    }
    if (vehicle.vin.toLowerCase() === input.vin.toLowerCase()) {
      throw new InventoryValidationError("VIN is already in use", "DUPLICATE_VIN");
    }
    if (vehicle.slug.toLowerCase() === input.slug.toLowerCase()) {
      throw new InventoryValidationError("URL slug is already in use", "DUPLICATE_SLUG");
    }
  }
}

function auditAction(before: VehicleRecord | null, after: VehicleRecord): VehicleAuditAction {
  if (!before) return "create";
  if (before.status === after.status) return "update";
  if (after.status === "published") return "publish";
  if (before.status === "published" && after.status === "draft") return "unpublish";
  if (after.status === "pending") return "pending";
  if (after.status === "sold") return "sold";
  if (after.status === "archived") return "archive";
  if (before.status === "archived") return "restore";
  return "update";
}

export async function listAllVehicles(): Promise<InventoryState> {
  return readInventoryState();
}

export async function listPublishedVehicles(): Promise<VehicleRecord[]> {
  const state = await readInventoryState();
  return state.vehicles
    .filter((vehicle) => vehicle.status === "published")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function findPublishedVehicleBySlug(slug: string): Promise<VehicleRecord | null> {
  const state = await readInventoryState();
  return state.vehicles.find((vehicle) => vehicle.status === "published" && vehicle.slug === slug) ?? null;
}

export async function createVehicle(rawInput: unknown): Promise<VehicleRecord> {
  const input = vehicleInputSchema.parse(rawInput);
  const current = await readInventoryState();
  assertUnique(current, input);
  const now = new Date().toISOString();
  const { expectedVersion: _expectedVersion, ...recordInput } = input;
  void _expectedVersion;
  const vehicle: VehicleRecord = {
    ...recordInput,
    id: randomUUID(),
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await writeVehicleAuditSnapshot({
    actor: adminConfig().identifier,
    action: "create",
    recordId: vehicle.id,
    before: null,
    after: vehicle,
  });
  const next = await mutateInventoryState(
    (state) => {
      assertUnique(state, input);
      return { ...state, vehicles: [...state.vehicles, vehicle] };
    },
    current.revision,
  );
  return next.vehicles.find((candidate) => candidate.id === vehicle.id) ?? vehicle;
}

export async function updateVehicle(id: string, rawInput: unknown): Promise<VehicleRecord> {
  const input = vehicleInputSchema.parse(rawInput);
  const current = await readInventoryState();
  const before = current.vehicles.find((vehicle) => vehicle.id === id);
  if (!before) throw new InventoryValidationError("Vehicle was not found", "NOT_FOUND");
  if (input.expectedVersion !== before.version) throw new StateConflictError("Vehicle changed; reload before saving");
  if (!canTransitionVehicle(before.status, input.status)) {
    throw new InventoryValidationError(
      `Status cannot change from ${before.status} to ${input.status}`,
      "INVALID_STATUS_TRANSITION",
    );
  }
  assertUnique(current, input, id);
  const { expectedVersion: _expectedVersion, ...recordInput } = input;
  void _expectedVersion;
  const after: VehicleRecord = {
    ...recordInput,
    id,
    version: before.version + 1,
    createdAt: before.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await writeVehicleAuditSnapshot({
    actor: adminConfig().identifier,
    action: auditAction(before, after),
    recordId: id,
    before,
    after,
  });
  const next = await mutateInventoryState(
    (state) => {
      const latest = state.vehicles.find((vehicle) => vehicle.id === id);
      if (!latest || latest.version !== before.version) throw new StateConflictError("Vehicle changed; reload before saving");
      assertUnique(state, input, id);
      return {
        ...state,
        vehicles: state.vehicles.map((vehicle) => (vehicle.id === id ? after : vehicle)),
      };
    },
    current.revision,
  );
  return next.vehicles.find((vehicle) => vehicle.id === id) ?? after;
}
