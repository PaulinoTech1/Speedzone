import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { localSecurityPath } from "@/lib/server/env";
import {
  authDatabase,
  authDatabaseConfigured,
  translateAuthDatabaseError,
} from "@/lib/server/storage/neon";

export type ConsumeNamespace = "challenge" | "recovery" | "bootstrap" | "stepup";

type Marker = {
  namespace: ConsumeNamespace;
  digest: string;
  expiresAt: number;
  consumedAt: string;
};

const memoryMarkers = globalThis as typeof globalThis & { __speedzoneConsumeMarkers?: Set<string> };

/**
 * Burn a single-use authentication artifact and report whether this caller was
 * the one that burned it. In SEcure_Auth the composite primary key is the
 * guarantee: a replayed digest cannot insert a second row, so `false` here is a
 * replay regardless of how many instances raced.
 */
export async function consumeOnce(
  namespace: ConsumeNamespace,
  digest: string,
  expiresAt: number,
): Promise<boolean> {
  if (authDatabaseConfigured()) {
    const sql = authDatabase();
    try {
      const rows = (await sql`
        INSERT INTO auth_consume_markers (namespace, digest, expires_at)
        VALUES (${namespace}, ${digest}, to_timestamp(${expiresAt}::double precision / 1000))
        ON CONFLICT (namespace, digest) DO NOTHING
        RETURNING 1 AS consumed
      `) as unknown[];
      return rows.length === 1;
    } catch (error) {
      throw translateAuthDatabaseError(error);
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("The SEcure_Auth database is required for one-time security markers");
  }

  const key = `${namespace}:${digest}`;
  const marker: Marker = { namespace, digest, expiresAt, consumedAt: new Date().toISOString() };
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
