import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { put } from "@vercel/blob";

import type { VehicleRecord } from "@/lib/domain/vehicle";
import { stableJsonHash } from "@/lib/server/crypto";
import { privateBlobToken } from "@/lib/server/env";

export type VehicleAuditAction =
  | "create"
  | "update"
  | "publish"
  | "unpublish"
  | "pending"
  | "sold"
  | "archive"
  | "restore";

export async function writeVehicleAuditSnapshot(input: {
  actor: string;
  action: VehicleAuditAction;
  recordId: string;
  before: VehicleRecord | null;
  after: VehicleRecord | null;
}): Promise<string> {
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replaceAll(":", "-");
  const pathname = `audit/vehicles/${input.recordId}/${safeTimestamp}-${randomUUID()}.json`;
  const record = {
    schemaVersion: 1,
    actor: input.actor,
    action: input.action,
    timestamp,
    recordId: input.recordId,
    beforeHash: input.before ? stableJsonHash(input.before) : null,
    afterHash: input.after ? stableJsonHash(input.after) : null,
    before: input.before,
    after: input.after,
  };
  const body = `${JSON.stringify(record)}\n`;
  const token = privateBlobToken();
  if (token) {
    const result = await put(pathname, body, {
      access: "private",
      token,
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/json",
    });
    return result.pathname;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Private Blob storage is required for inventory audits");
  }
  const localPath = resolve(`.data/${pathname}`);
  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, body, { encoding: "utf8", flag: "wx" });
  return localPath;
}
