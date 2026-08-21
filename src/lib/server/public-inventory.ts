import "server-only";

import { unstable_cache } from "next/cache";

import {
  findPublishedVehicleBySlug,
  listPublishedVehicles,
} from "@/lib/server/inventory";

export const cachedPublishedVehicles = unstable_cache(
  listPublishedVehicles,
  ["published-inventory-v1"],
  { tags: ["inventory"], revalidate: 300 },
);

export const cachedPublishedVehicleBySlug = unstable_cache(
  findPublishedVehicleBySlug,
  ["published-vehicle-v1"],
  { tags: ["inventory"], revalidate: 300 },
);
