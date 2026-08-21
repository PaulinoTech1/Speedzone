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
  type VehicleRecord,
} from "@/lib/domain/vehicle";
import {
  globalConfigSettings,
  adminConfig,
  localStatePath,
  privateBlobToken,
  tokenConfig,
  webAuthnConfig,
  type GlobalConfigKind,
} from "@/lib/server/env";

const stateKeys = {
  auth: "auth_state_v1",
  inventory: "inventory_state_v1",
} as const;

const authStateBlobPath = "security/auth/state-v1.json";
const authStateMaximumBytes = 256 * 1024;
const authStateMutationAttempts = 5;
const authMirrorAttempts = 3;

type LocalState = { auth: AuthState; inventory: InventoryState };
type MutationOperation =
  | { operation: "upsert" | "create" | "update"; key: string; value: unknown }
  | { operation: "delete"; key: string };

export class StateConflictError extends Error {}
export class StateConfigurationError extends Error {}

function validatedAuthState(value: unknown): AuthState {
  try {
    return parseAuthState(value);
  } catch {
    throw new StateConfigurationError("Authentication record is malformed");
  }
}

type AuthBlobSnapshot = {
  state: AuthState;
  etag: string;
};

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

function assertAuthMirrorConfigured(forWrite: boolean): void {
  if (process.env.NODE_ENV !== "production") return;
  const settings = globalConfigSettings("auth");
  if (!settings.connectionString) {
    throw new StateConfigurationError("Auth Global Config mirror is not configured");
  }
  if (forWrite && (!settings.configId || !settings.apiToken)) {
    throw new StateConfigurationError("Auth Global Config mirror write settings are incomplete");
  }
}

function authoritativeAuthBlobToken(): string | undefined {
  const token = privateBlobToken();
  const requiresBlob = process.env.NODE_ENV === "production" || hasGlobalConfig("auth");
  if (!requiresBlob) return undefined;
  if (!token) {
    throw new StateConfigurationError(
      "Private Blob storage is required for authoritative authentication state",
    );
  }
  return token;
}

async function readGlobal<T>(kind: GlobalConfigKind, fallback: T): Promise<T> {
  const settings = globalConfigSettings(kind);
  if (!settings.connectionString) return fallback;
  const client = createClient(settings.connectionString);
  return (await client.get<T>(stateKeys[kind], { consistentRead: true })) ?? fallback;
}

async function patchGlobal(kind: GlobalConfigKind, items: MutationOperation[]): Promise<void> {
  const settings = globalConfigSettings(kind);
  if (!settings.configId || !settings.apiToken) {
    throw new StateConfigurationError(`${kind} Global Config write settings are incomplete`);
  }
  const url = new URL(`https://api.vercel.com/v1/global-config/${encodeURIComponent(settings.configId)}/items`);
  if (settings.teamId) url.searchParams.set("teamId", settings.teamId);
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${settings.apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ items }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Global Config ${kind} update failed with status ${response.status}`);
  }
}

async function readAuthBlob(token: string): Promise<AuthBlobSnapshot | null> {
  const result = await get(authStateBlobPath, {
    access: "private",
    token,
    useCache: false,
  });
  if (!result) return null;
  if (result.statusCode !== 200 || !result.stream) {
    throw new StateConfigurationError("Authoritative authentication state could not be read");
  }
  if (result.blob.size > authStateMaximumBytes) {
    throw new StateConfigurationError("Authoritative authentication state exceeds its size limit");
  }
  const body = await new Response(result.stream).text();
  return {
    state: validatedAuthState(JSON.parse(body) as unknown),
    etag: result.blob.etag,
  };
}

async function createAuthBlob(token: string, state: AuthState): Promise<AuthBlobSnapshot> {
  const result = await put(authStateBlobPath, `${JSON.stringify(state)}\n`, {
    access: "private",
    token,
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json",
  });
  return { state, etag: result.etag };
}

async function replaceAuthBlob(
  token: string,
  expectedEtag: string,
  state: AuthState,
): Promise<AuthBlobSnapshot> {
  const result = await put(authStateBlobPath, `${JSON.stringify(state)}\n`, {
    access: "private",
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    ifMatch: expectedEtag,
    contentType: "application/json",
  });
  return { state, etag: result.etag };
}

async function readAuthoritativeAuthState(token: string): Promise<AuthBlobSnapshot> {
  for (let attempt = 0; attempt < authStateMutationAttempts; attempt += 1) {
    const existing = await readAuthBlob(token);
    if (existing) return existing;

    // This is both first-install initialization and the migration path from the
    // former Global-Config-authoritative implementation. Once this immutable
    // pathname exists, every authentication read comes from private Blob.
    const seed = hasGlobalConfig("auth")
      ? validatedAuthState(await readGlobal("auth", emptyAuthState()))
      : emptyAuthState();
    try {
      return await createAuthBlob(token, seed);
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) continue;
      throw error;
    }
  }
  throw new StateConflictError("Authentication state initialization conflicted; retry the operation");
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

function logAuthMirrorFailure(error: unknown): void {
  console.error(
    JSON.stringify({
      type: "speedzone.storage",
      timestamp: new Date().toISOString(),
      event: "auth_state_mirror",
      outcome: "failure",
      reason: error instanceof Error ? error.name : "unknown",
    }),
  );
}

async function mirrorCurrentAuthState(token: string): Promise<void> {
  if (!hasGlobalConfig("auth")) return;
  for (let attempt = 0; attempt < authMirrorAttempts; attempt += 1) {
    const before = await readAuthBlob(token);
    if (!before) throw new StateConfigurationError("Authoritative authentication state is missing");
    await patchGlobal("auth", [{ operation: "upsert", key: stateKeys.auth, value: before.state }]);
    const after = await readAuthBlob(token);
    if (after?.state.revision === before.state.revision) return;
  }
  throw new StateConflictError("Authentication mirror could not catch up with authoritative state");
}

function indexKey(kind: "stock" | "vin" | "slug", value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return `${kind}_${normalized}`.slice(0, 256);
}

function vehicleIndexes(vehicle: VehicleRecord): Map<string, string> {
  return new Map([
    [indexKey("stock", vehicle.stockNumber), vehicle.id],
    [indexKey("vin", vehicle.vin), vehicle.id],
    [indexKey("slug", vehicle.slug), vehicle.id],
  ]);
}

function inventoryOperations(previous: InventoryState, next: InventoryState): MutationOperation[] {
  const before = new Map<string, string>();
  const after = new Map<string, string>();
  for (const vehicle of previous.vehicles) for (const entry of vehicleIndexes(vehicle)) before.set(...entry);
  for (const vehicle of next.vehicles) for (const entry of vehicleIndexes(vehicle)) after.set(...entry);

  const operations: MutationOperation[] = [
    { operation: "upsert", key: stateKeys.inventory, value: next },
  ];
  for (const key of before.keys()) if (!after.has(key)) operations.push({ operation: "delete", key });
  for (const [key, id] of after) {
    if (!before.has(key)) operations.push({ operation: "create", key, value: id });
  }
  return operations;
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
  const blobToken = authoritativeAuthBlobToken();
  let state: AuthState;
  if (blobToken) {
    assertAuthMirrorConfigured(false);
    state = (await readAuthoritativeAuthState(blobToken)).state;
  } else {
    state = (await readLocal()).auth;
  }
  if (state.state === "UNCONFIGURED") {
    throw new StateConfigurationError("Authentication record is not configured");
  }
  return state;
}

export async function readInventoryState(): Promise<InventoryState> {
  if (hasGlobalConfig("inventory")) {
    return inventoryStateSchema.parse(await readGlobal("inventory", emptyInventoryState()));
  }
  if (process.env.NODE_ENV === "production") {
    throw new StateConfigurationError("Inventory Global Config is not configured");
  }
  return (await readLocal()).inventory;
}

export async function mutateAuthState(
  mutate: (current: AuthState) => AuthState,
  expectedRevision?: number,
): Promise<AuthState> {
  return withLock("auth", async () => {
    const blobToken = authoritativeAuthBlobToken();
    if (!blobToken) {
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

    assertAuthMirrorConfigured(true);
    for (let attempt = 0; attempt < authStateMutationAttempts; attempt += 1) {
      const current = await readAuthoritativeAuthState(blobToken);
      if (expectedRevision !== undefined && current.state.revision !== expectedRevision) {
        throw new StateConflictError("Authentication state changed; retry the operation");
      }
      const next = authStateSchema.parse({
        ...mutate(structuredClone(current.state)),
        revision: current.state.revision + 1,
      });
      validateProtectedAuthProgression(current.state, next);

      try {
        await replaceAuthBlob(blobToken, current.etag, next);
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) {
          if (attempt + 1 < authStateMutationAttempts) continue;
          throw new StateConflictError("Authentication state remained busy; retry the operation");
        }
        throw error;
      }

      // The private Blob commit is authoritative. A mirror outage must not turn
      // a completed one-time security operation into an ambiguous client retry.
      try {
        await mirrorCurrentAuthState(blobToken);
      } catch (error) {
        logAuthMirrorFailure(error);
      }
      return next;
    }
    throw new StateConflictError("Authentication state remained busy; retry the operation");
  });
}

export async function mutateInventoryState(
  mutate: (current: InventoryState) => InventoryState,
  expectedRevision?: number,
): Promise<InventoryState> {
  return withLock("inventory", async () => {
    const current = await readInventoryState();
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      throw new StateConflictError("Inventory changed; reload before saving again");
    }
    const next = inventoryStateSchema.parse({
      ...mutate(structuredClone(current)),
      revision: current.revision + 1,
    });
    if (hasGlobalConfig("inventory")) {
      await patchGlobal("inventory", inventoryOperations(current, next));
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new StateConfigurationError("Inventory Global Config is not configured");
      }
      const local = await readLocal();
      await writeLocal({ ...local, inventory: next });
    }
    return next;
  });
}
