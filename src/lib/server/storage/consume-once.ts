import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { BlobPreconditionFailedError, put } from "@vercel/blob";

import { localSecurityPath, privateBlobToken } from "@/lib/server/env";

type ConsumeNamespace = "challenge" | "recovery" | "bootstrap" | "stepup";

type Marker = {
  namespace: ConsumeNamespace;
  digest: string;
  expiresAt: number;
  consumedAt: string;
};

const memoryMarkers = globalThis as typeof globalThis & { __speedzoneConsumeMarkers?: Set<string> };

export async function consumeOnce(
  namespace: ConsumeNamespace,
  digest: string,
  expiresAt: number,
): Promise<boolean> {
  const key = `${namespace}:${digest}`;
  const marker: Marker = { namespace, digest, expiresAt, consumedAt: new Date().toISOString() };
  const token = privateBlobToken();

  if (token) {
    try {
      await put(`security/consume/${namespace}/${digest}.json`, JSON.stringify(marker), {
        access: "private",
        token,
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json",
      });
      return true;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) return false;
      throw error;
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Private Blob storage is required for one-time security markers");
  }

  const markerSet = (memoryMarkers.__speedzoneConsumeMarkers ??= new Set());
  if (markerSet.has(key)) return false;
  markerSet.add(key);

  const path = resolve(localSecurityPath(), namespace, `${digest}.json`);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify(marker)}\n`, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}
