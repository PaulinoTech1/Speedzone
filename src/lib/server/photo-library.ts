import "server-only";

import { del, list, type ListBlobResultBlob } from "@vercel/blob";

import type { VehicleRecord, VehicleStatus } from "@/lib/domain/vehicle";
import { photoBlobToken, privateBlobToken } from "@/lib/server/env";
import { listAllVehicles } from "@/lib/server/inventory";
import { StateConfigurationError } from "@/lib/server/storage/state";

/**
 * `linked`   the object is referenced by a vehicle record and is in use.
 * `unlinked` the object sits in the public photo store but no vehicle points at
 *            it, usually a photograph that was replaced or whose vehicle was
 *            deleted. It is still publicly reachable by URL until removed.
 * `staging`  a private upload that never reached finalization, left behind by a
 *            cancelled or failed upload.
 */
export type PhotoLibraryState = "linked" | "unlinked" | "staging";

export type PhotoLibraryEntry = {
  pathname: string;
  url: string;
  size: number;
  uploadedAt: string;
  state: PhotoLibraryState;
  vehicleId: string | null;
  vehicleTitle: string | null;
  vehicleStatus: VehicleStatus | null;
  width: number | null;
  height: number | null;
  alt: string | null;
};

/** A vehicle references this pathname, but no object with it exists any more. */
export type MissingPhoto = {
  pathname: string;
  url: string;
  vehicleId: string;
  vehicleTitle: string;
  vehicleStatus: VehicleStatus;
};

export type PhotoLibrary = {
  entries: PhotoLibraryEntry[];
  missing: MissingPhoto[];
  totals: {
    objects: number;
    bytes: number;
    linked: number;
    unlinked: number;
    unlinkedBytes: number;
    staging: number;
    stagingBytes: number;
  };
  truncated: boolean;
};

const publishedPhotoPrefix = "vehicles/";
const stagingPhotoPrefix = "staging/vehicles/";
const listPageSize = 1000;
const maximumListPages = 20;

function vehicleTitle(vehicle: VehicleRecord): string {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter((part) => part !== undefined && String(part).trim().length > 0)
    .join(" ");
}

/** `vehicles/<id>/<file>` and `staging/vehicles/<id>/<file>` both carry the ID. */
function vehicleIdFromPathname(pathname: string): string | null {
  const match = /^(?:staging\/)?vehicles\/([0-9a-f-]{36})\//.exec(pathname);
  return match?.[1] ?? null;
}

/**
 * Enumerate one store under a fixed prefix. The prefix is never caller-supplied:
 * the private store also holds audit snapshots, so a media view must not be able
 * to widen its own scope and enumerate them.
 */
async function listPrefix(
  prefix: string,
  token: string,
): Promise<{ blobs: ListBlobResultBlob[]; truncated: boolean }> {
  const blobs: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maximumListPages; page += 1) {
    const result = await list({ prefix, token, limit: listPageSize, cursor });
    blobs.push(...result.blobs);
    if (!result.hasMore || !result.cursor) return { blobs, truncated: false };
    cursor = result.cursor;
  }
  return { blobs, truncated: true };
}

function requiredToken(token: string | undefined, store: string): string {
  if (!token) throw new StateConfigurationError(`${store} Blob storage is not configured`);
  return token;
}

/**
 * Reconcile both Blob stores against the inventory record. The inventory record
 * is the source of truth for what a photograph *should* be; the stores are the
 * source of truth for what actually exists. Anything that appears in only one of
 * them is what an operator needs to see.
 */
export async function readPhotoLibrary(): Promise<PhotoLibrary> {
  const photoToken = requiredToken(photoBlobToken(), "Public photo");
  const privateToken = requiredToken(privateBlobToken(), "Private staging");
  const inventory = await listAllVehicles();

  const [published, staging] = await Promise.all([
    listPrefix(publishedPhotoPrefix, photoToken),
    listPrefix(stagingPhotoPrefix, privateToken),
  ]);

  const vehiclesById = new Map(inventory.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const referenced = new Map<string, { vehicle: VehicleRecord; photo: VehicleRecord["photographs"][number] }>();
  for (const vehicle of inventory.vehicles) {
    for (const photo of vehicle.photographs) referenced.set(photo.pathname, { vehicle, photo });
  }

  const entries: PhotoLibraryEntry[] = [];
  const seen = new Set<string>();

  for (const blob of published.blobs) {
    seen.add(blob.pathname);
    const reference = referenced.get(blob.pathname);
    const vehicle = reference?.vehicle ?? vehiclesById.get(vehicleIdFromPathname(blob.pathname) ?? "");
    entries.push({
      pathname: blob.pathname,
      url: blob.url,
      size: blob.size,
      uploadedAt: blob.uploadedAt.toISOString(),
      state: reference ? "linked" : "unlinked",
      vehicleId: vehicle?.id ?? vehicleIdFromPathname(blob.pathname),
      vehicleTitle: vehicle ? vehicleTitle(vehicle) : null,
      vehicleStatus: vehicle?.status ?? null,
      width: reference?.photo.width ?? null,
      height: reference?.photo.height ?? null,
      alt: reference?.photo.alt ?? null,
    });
  }

  for (const blob of staging.blobs) {
    const vehicle = vehiclesById.get(vehicleIdFromPathname(blob.pathname) ?? "");
    entries.push({
      pathname: blob.pathname,
      // A private staging object is not publicly readable; the URL is shown only
      // so an operator can identify the object, never as a working preview.
      url: blob.url,
      size: blob.size,
      uploadedAt: blob.uploadedAt.toISOString(),
      state: "staging",
      vehicleId: vehicle?.id ?? vehicleIdFromPathname(blob.pathname),
      vehicleTitle: vehicle ? vehicleTitle(vehicle) : null,
      vehicleStatus: vehicle?.status ?? null,
      width: null,
      height: null,
      alt: null,
    });
  }

  const missing: MissingPhoto[] = [];
  for (const [pathname, reference] of referenced) {
    if (seen.has(pathname)) continue;
    missing.push({
      pathname,
      url: reference.photo.url,
      vehicleId: reference.vehicle.id,
      vehicleTitle: vehicleTitle(reference.vehicle),
      vehicleStatus: reference.vehicle.status,
    });
  }

  entries.sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));

  const totals = entries.reduce(
    (accumulator, entry) => ({
      objects: accumulator.objects + 1,
      bytes: accumulator.bytes + entry.size,
      linked: accumulator.linked + (entry.state === "linked" ? 1 : 0),
      unlinked: accumulator.unlinked + (entry.state === "unlinked" ? 1 : 0),
      unlinkedBytes: accumulator.unlinkedBytes + (entry.state === "unlinked" ? entry.size : 0),
      staging: accumulator.staging + (entry.state === "staging" ? 1 : 0),
      stagingBytes: accumulator.stagingBytes + (entry.state === "staging" ? entry.size : 0),
    }),
    { objects: 0, bytes: 0, linked: 0, unlinked: 0, unlinkedBytes: 0, staging: 0, stagingBytes: 0 },
  );

  return {
    entries,
    missing,
    totals,
    truncated: published.truncated || staging.truncated,
  };
}

export class PhotoLibraryDeletionError extends Error {}

/**
 * Delete one orphaned object. The caller's pathname is never trusted as a
 * deletion target: the library is recomputed and the pathname must appear in it
 * as `unlinked` or `staging`. A linked photograph, an audit object, or any path
 * outside the two known prefixes cannot be reached through this function.
 */
export async function deleteOrphanedPhoto(pathname: string): Promise<PhotoLibraryEntry> {
  const library = await readPhotoLibrary();
  const entry = library.entries.find((candidate) => candidate.pathname === pathname);
  if (!entry) {
    throw new PhotoLibraryDeletionError("That photograph is no longer in the store");
  }
  if (entry.state === "linked") {
    throw new PhotoLibraryDeletionError(
      "That photograph is still used by a vehicle; remove it from the vehicle first",
    );
  }

  const token =
    entry.state === "staging"
      ? requiredToken(privateBlobToken(), "Private staging")
      : requiredToken(photoBlobToken(), "Public photo");
  await del(entry.url, { token });
  return entry;
}
