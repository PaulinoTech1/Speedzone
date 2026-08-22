import "server-only";

import { unstable_cache } from "next/cache";

import type { VehicleRecord } from "@/lib/domain/vehicle";
import {
  findPublishedVehicleBySlug,
  listPublishedVehicles,
} from "@/lib/server/inventory";
import { StateConfigurationError } from "@/lib/server/storage/state";

// Public marketing routes (inventory list/detail, sitemap, llms.txt) are
// read-only and best-effort: if inventory storage isn't configured yet (or
// is briefly unreachable), degrade to "no vehicles" instead of a 500. Admin
// routes call listPublishedVehicles/findPublishedVehicleBySlug directly and
// still surface the configuration error, since that failure is actionable
// for an operator but not for a site visitor.
export async function listPublishedVehiclesOrEmpty(): Promise<VehicleRecord[]> {
  try {
    return await listPublishedVehicles();
  } catch (error) {
    if (error instanceof StateConfigurationError) {
      console.error("Public inventory read degraded to empty: storage is not configured");
      return [];
    }
    throw error;
  }
}

export async function findPublishedVehicleBySlugOrNull(slug: string): Promise<VehicleRecord | null> {
  try {
    return await findPublishedVehicleBySlug(slug);
  } catch (error) {
    if (error instanceof StateConfigurationError) {
      console.error("Public vehicle read degraded to not-found: storage is not configured");
      return null;
    }
    throw error;
  }
}

export const cachedPublishedVehicles = unstable_cache(
  listPublishedVehiclesOrEmpty,
  ["published-inventory-v1"],
  { tags: ["inventory"], revalidate: 300 },
);

export const cachedPublishedVehicleBySlug = unstable_cache(
  findPublishedVehicleBySlugOrNull,
  ["published-vehicle-v1"],
  { tags: ["inventory"], revalidate: 300 },
);
