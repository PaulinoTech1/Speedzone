import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export const pool = new Pool({ connectionString: process.env.AUTH_DATABASE_URL ?? process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
