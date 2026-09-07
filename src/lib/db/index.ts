import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const connectionString =
  process.env.AUTH_DATABASE_URL ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL_UNPOOLED;

const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";

if (!connectionString && !isProductionBuild) {
  throw new Error("Missing Neon database connection string");
}

export const pool = new Pool({
  connectionString: connectionString ?? "postgresql://build:build@127.0.0.1:5432/build",
});
export const db = drizzle(pool, { schema });
