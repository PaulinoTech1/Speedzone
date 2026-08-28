import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { createClient } from "@vercel/global-config";

import {
  authStateSchema,
  emptyAuthState,
  parseAuthState,
  type AuthState,
} from "@/lib/domain/auth";
import {
  emptyInventoryState,
  inventoryStateSchema,
  type InventoryState,
} from "@/lib/domain/vehicle";
import {
  globalConfigSettings,
  adminConfig,
  inventoryBlobCredentials,
  localStatePath,
  privateBlobToken,
  tokenConfig,
  webAuthnConfig,
  type GlobalConfigKind,
  type InventoryBlobCredentials,
} from "@/lib/server/env";
import { StateConfigurationError, StateConflictError } from "@/lib/server/storage/errors";
import {
  authDatabase,
  authDatabaseConfigured,
  translateAuthDatabaseError,
  type AuthSql,
} from "@/lib/server/storage/neon";

export { StateConfigurationError, StateConflictError };

const stateKeys = {
  auth: "auth_state_v1",
  inventory: "inventory_state_v1",
} as const;

// Read-only migration sources for the one-time move of authentication into the
// SEcure_Auth Neon database. Nothing writes back to either of them.
const legacyAuthStateBlobPath = "security/auth/state-v1.json";
const legacyAuthStateMaximumBytes = 256 * 1024;

const authStateMutationAttempts = 5;
const inventoryStateBlobPath = "inventory/state-v1.json";
const inventoryStateMaximumBytes = 32 * 1024 * 1024;
const inventoryStateMutationAttempts = 5;

type LocalState = { auth: AuthState; inventory: InventoryState };

function validatedAuthState(value: unknown): AuthState {
  try {
    return parseAuthState(value);
  } catch {
    throw new StateConfigurationError("Authentication record is malformed");
  }
}

type InventoryBlobSnapshot = {
  state: InventoryState;
  etag: string;
};

function validatedInventoryState(value: unknown): InventoryState {
  try {
    return inventoryStateSchema.parse(value);
  } catch {
    throw new StateConfigurationError("Inventory record is malformed");
  }
}

function emptyLocalState(): LocalState {
  return { auth: emptyAuthState(), inventory: emptyInventoryState() };
}

async function readLocal(): Promise<LocalState> {
  const path = resolve(localStatePath());
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    const candidate = parsed as Partial<LocalState>;
    return {
      auth: validatedAuthState(candidate.auth ?? emptyAuthState()),
      inventory: inventoryStateSchema.parse(candidate.inventory ?? emptyInventoryState()),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLocalState();
    throw error;
  }
}

async function writeLocal(state: LocalState): Promise<void> {
  const path = resolve(localStatePath());
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

function hasGlobalConfig(kind: GlobalConfigKind): boolean {
  const settings = globalConfigSettings(kind);
  return Boolean(settings.connectionString);
}

/**
 * Authentication is authoritative in Neon. Production must have the connection
 * configured or every authorization read fails closed; local development still
 * falls back to the on-disk record so `npm run dev` needs no database.
 */
function authDatabaseIsAuthoritative(): boolean {
  if (authDatabaseConfigured()) return true;
  if (process.env.NODE_ENV === "production") {
    throw new StateConfigurationError("Authentication database is not configured");
  }
  return false;
}

function authoritativeInventoryBlobCredentials(): InventoryBlobCredentials | undefined {
  const credentials = inventoryBlobCredentials();
  const requiresBlob = process.env.NODE_ENV === "production" || hasGlobalConfig("inventory");
  if (!requiresBlob) return undefined;
  if (!credentials) {
    throw new StateConfigurationError(
      "Private Blob storage is required for authoritative inventory state",
    );
  }
  return credentials;
}

async function readGlobal<T>(kind: GlobalConfigKind, fallback: T): Promise<T> {
  const settings = globalConfigSettings(kind);
  if (!settings.connectionString) return fallback;
  const client = createClient(settings.connectionString);
  return (await client.get<T>(stateKeys[kind], { consistentRead: true })) ?? fallback;
}

async function runAuthQuery<T>(run: (sql: AuthSql) => Promise<T>): Promise<T> {
  try {
    return await run(authDatabase());
  } catch (error) {
    throw translateAuthDatabaseError(error);
  }
}

async function selectAuthState(): Promise<AuthState | null> {
  const rows = (await runAuthQuery(
    (sql) => sql`SELECT state::text AS state FROM auth_state WHERE id = 1`,
  )) as Array<{ state: string }>;
  const row = rows[0];
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.state) as unknown;
  } catch {
    throw new StateConfigurationError("Authentication record is malformed");
  }
  return validatedAuthState(parsed);
}

/** Create the singleton row. Returns false when a concurrent writer won the race. */
async function insertAuthState(state: AuthState): Promise<boolean> {
  const rows = (await runAuthQuery(
    (sql) => sql`
      INSERT INTO auth_state (id, revision, state)
      VALUES (1, ${state.revision}, ${JSON.stringify(state)}::jsonb)
      ON CONFLICT (id) DO NOTHING
      RETURNING 1 AS inserted
    `,
  )) as unknown[];
  return rows.length === 1;
}

/**
 * The compare-and-swap that serialises authentication mutations across every
 * serverless instance. One statement is its own transaction, so a competing
 * writer either loses the revision match or is rejected; it cannot interleave.
 */
async function compareAndSwapAuthState(expectedRevision: number, next: AuthState): Promise<boolean> {
  const rows = (await runAuthQuery(
    (sql) => sql`
      UPDATE auth_state
         SET revision = ${next.revision},
             state = ${JSON.stringify(next)}::jsonb,
             updated_at = now()
       WHERE id = 1 AND revision = ${expectedRevision}
      RETURNING 1 AS updated
    `,
  )) as unknown[];
  return rows.length === 1;
}

async function readLegacyAuthBlob(token: string): Promise<AuthState | null> {
  const result = await get(legacyAuthStateBlobPath, {
    access: "private",
    token,
    useCache: false,
  });
  if (!result) return null;
  if (result.statusCode !== 200 || !result.stream) {
    throw new StateConfigurationError("Legacy authentication state could not be read");
  }
  if (result.blob.size > legacyAuthStateMaximumBytes) {
    throw new StateConfigurationError("Legacy authentication state exceeds its size limit");
  }
  const body = await new Response(result.stream).text();
  return validatedAuthState(JSON.parse(body) as unknown);
}

/**
 * Seed value for the first SEcure_Auth row. An existing deployment is carried
 * over from its former private-Blob object, or the older Global Config mirror,
 * so enrolled passkeys and the session epoch survive the cutover.
 */
async function legacyAuthSeed(): Promise<AuthState> {
  const token = privateBlobToken();
  if (token) {
    const legacy = await readLegacyAuthBlob(token);
    if (legacy) return legacy;
  }
  if (hasGlobalConfig("auth")) {
    return validatedAuthState(await readGlobal("auth", emptyAuthState()));
  }
  return emptyAuthState();
}

async function readAuthoritativeAuthState(): Promise<AuthState> {
  for (let attempt = 0; attempt < authStateMutationAttempts; attempt += 1) {
    const existing = await selectAuthState();
    if (existing) return existing;
    // First cutover only. Once the singleton row exists, every authentication
    // read and write stays inside SEcure_Auth.
    await insertAuthState(await legacyAuthSeed());
  }
  throw new StateConflictError("Authentication state initialization conflicted; retry the operation");
}

function serializedInventoryState(state: InventoryState): string {
  const body = `${JSON.stringify(state)}\n`;
  if (Buffer.byteLength(body, "utf8") > inventoryStateMaximumBytes) {
    throw new StateConfigurationError("Inventory record exceeds its size limit");
  }
  return body;
}

async function readInventoryBlob(
  credentials: InventoryBlobCredentials,
): Promise<InventoryBlobSnapshot | null> {
  const result = await get(inventoryStateBlobPath, {
    access: "private",
    ...credentials,
    useCache: false,
  });
  if (!result) return null;
  if (result.statusCode !== 200 || !result.stream) {
    throw new StateConfigurationError("Authoritative inventory state could not be read");
  }
  if (result.blob.size > inventoryStateMaximumBytes) {
    throw new StateConfigurationError("Authoritative inventory state exceeds its size limit");
  }
  if (result.blob.contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new StateConfigurationError("Authoritative inventory state has an invalid content type");
  }
  try {
    const body = await new Response(result.stream).text();
    return {
      state: validatedInventoryState(JSON.parse(body) as unknown),
      etag: result.blob.etag,
    };
  } catch (error) {
    if (error instanceof StateConfigurationError) throw error;
    throw new StateConfigurationError("Inventory record is malformed");
  }
}

async function createInventoryBlob(
  credentials: InventoryBlobCredentials,
  state: InventoryState,
): Promise<InventoryBlobSnapshot> {
  const result = await put(inventoryStateBlobPath, serializedInventoryState(state), {
    access: "private",
    ...credentials,
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json",
  });
  return { state, etag: result.etag };
}

async function replaceInventoryBlob(
  credentials: InventoryBlobCredentials,
  expectedEtag: string,
  state: InventoryState,
): Promise<InventoryBlobSnapshot> {
  const result = await put(inventoryStateBlobPath, serializedInventoryState(state), {
    access: "private",
    ...credentials,
    addRandomSuffix: false,
    allowOverwrite: true,
    ifMatch: expectedEtag,
    contentType: "application/json",
  });
  return { state, etag: result.etag };
}

async function readAuthoritativeInventoryState(
  credentials: InventoryBlobCredentials,
): Promise<InventoryBlobSnapshot> {
  for (let attempt = 0; attempt < inventoryStateMutationAttempts; attempt += 1) {
    const existing = await readInventoryBlob(credentials);
    if (existing) return existing;

    // This seeds the new authoritative object from the former Global Config
    // record once. After creation, every inventory read comes from private Blob.
    const seed = hasGlobalConfig("inventory")
      ? validatedInventoryState(await readGlobal("inventory", emptyInventoryState()))
      : emptyInventoryState();
    try {
      return await createInventoryBlob(credentials, seed);
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) continue;
      throw error;
    }
  }
  throw new StateConflictError("Inventory state initialization conflicted; retry the operation");
}

function validateProtectedAuthProgression(current: AuthState, next: AuthState): void {
  const allowedTransitions: Record<AuthState["state"], ReadonlySet<AuthState["state"]>> = {
    UNCONFIGURED: new Set(["UNCONFIGURED", "BOOTSTRAP_READY"]),
    BOOTSTRAP_READY: new Set(["BOOTSTRAP_READY", "ACTIVE"]),
    ACTIVE: new Set(["ACTIVE", "RECOVERY"]),
    RECOVERY: new Set(["RECOVERY", "ACTIVE"]),
  };
  if (!allowedTransitions[current.state].has(next.state)) {
    throw new StateConflictError("Authentication state transition is not permitted");
  }
  if (next.sessionEpoch < current.sessionEpoch) {
    throw new StateConflictError("Authentication session epoch cannot move backwards");
  }
  const currentPasskeys = new Map(current.passkeys.map((passkey) => [passkey.id, passkey]));
  for (const passkey of next.passkeys) {
    const previous = currentPasskeys.get(passkey.id);
    if (previous && passkey.counter < previous.counter) {
      throw new StateConflictError("Authenticator counters cannot move backwards");
    }
  }
}

type LockMap = Map<string, Promise<void>>;
const globalLocks = globalThis as typeof globalThis & { __speedzoneLocks?: LockMap };
const locks = (globalLocks.__speedzoneLocks ??= new Map());

async function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  const queued = previous.then(() => current);
  locks.set(key, queued);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}

export async function readAuthState(): Promise<AuthState> {
  try {
    adminConfig();
    tokenConfig();
    webAuthnConfig();
  } catch {
    throw new StateConfigurationError("Authentication environment is not configured");
  }
  const state = authDatabaseIsAuthoritative() ? await readAuthoritativeAuthState() : (await readLocal()).auth;
  if (state.state === "UNCONFIGURED") {
    throw new StateConfigurationError("Authentication record is not configured");
  }
  return state;
}

export async function readInventoryState(): Promise<InventoryState> {
  const credentials = authoritativeInventoryBlobCredentials();
  if (credentials) return (await readAuthoritativeInventoryState(credentials)).state;
  return (await readLocal()).inventory;
}

export async function mutateAuthState(
  mutate: (current: AuthState) => AuthState,
  expectedRevision?: number,
): Promise<AuthState> {
  return withLock("auth", async () => {
    if (!authDatabaseIsAuthoritative()) {
      const local = await readLocal();
      const current = local.auth;
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new StateConflictError("Authentication state changed; retry the operation");
      }
      const next = authStateSchema.parse({
        ...mutate(structuredClone(current)),
        revision: current.revision + 1,
      });
      validateProtectedAuthProgression(current, next);
      await writeLocal({ ...local, auth: next });
      return next;
    }

    for (let attempt = 0; attempt < authStateMutationAttempts; attempt += 1) {
      const current = await readAuthoritativeAuthState();
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new StateConflictError("Authentication state changed; retry the operation");
      }
      const next = authStateSchema.parse({
        ...mutate(structuredClone(current)),
        revision: current.revision + 1,
      });
      validateProtectedAuthProgression(current, next);
      if (await compareAndSwapAuthState(current.revision, next)) return next;
    }
    throw new StateConflictError("Authentication state remained busy; retry the operation");
  });
}

export async function mutateInventoryState(
  mutate: (current: InventoryState) => InventoryState,
  expectedRevision?: number,
): Promise<InventoryState> {
  return withLock("inventory", async () => {
    const credentials = authoritativeInventoryBlobCredentials();
    if (!credentials) {
      const local = await readLocal();
      const current = local.inventory;
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new StateConflictError("Inventory changed; reload before saving again");
      }
      const next = inventoryStateSchema.parse({
        ...mutate(structuredClone(current)),
        revision: current.revision + 1,
      });
      await writeLocal({ ...local, inventory: next });
      return next;
    }

    for (let attempt = 0; attempt < inventoryStateMutationAttempts; attempt += 1) {
      const current = await readAuthoritativeInventoryState(credentials);
      if (expectedRevision !== undefined && current.state.revision !== expectedRevision) {
        throw new StateConflictError("Inventory changed; reload before saving again");
      }
      const next = inventoryStateSchema.parse({
        ...mutate(structuredClone(current.state)),
        revision: current.state.revision + 1,
      });
      try {
        await replaceInventoryBlob(credentials, current.etag, next);
        return next;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) {
          if (attempt + 1 < inventoryStateMutationAttempts) continue;
          throw new StateConflictError("Inventory state remained busy; retry the operation");
        }
        throw error;
      }
    }
    throw new StateConflictError("Inventory state remained busy; retry the operation");
  });
}
