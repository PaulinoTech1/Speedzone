import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  row: null as { revision: number; state: string } | null,
  legacyBlob: null as string | null,
  globalAuth: null as unknown,
  updates: 0,
  conflictWriter: undefined as (() => void) | undefined,
  repeatConflict: false,
  updateFailure: null as Error | null,
  missingTable: false,
  connectionStrings: [] as string[],
}));

class UndefinedTableError extends Error {
  readonly code = "42P01";
}

vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn((connectionString: string) => {
    storage.connectionStrings.push(connectionString);
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ? ").replace(/\s+/g, " ").trim();
      if (storage.missingTable) return Promise.reject(new UndefinedTableError("relation missing"));

      if (text.startsWith("SELECT state::text")) {
        return Promise.resolve(storage.row ? [{ state: storage.row.state }] : []);
      }
      if (text.startsWith("INSERT INTO auth_state")) {
        if (storage.row) return Promise.resolve([]);
        storage.row = { revision: Number(values[0]), state: String(values[1]) };
        return Promise.resolve([{ inserted: 1 }]);
      }
      if (text.startsWith("UPDATE auth_state")) {
        if (storage.updateFailure) return Promise.reject(storage.updateFailure);
        storage.updates += 1;
        if (storage.conflictWriter) {
          const writer = storage.conflictWriter;
          if (!storage.repeatConflict) storage.conflictWriter = undefined;
          writer();
          return Promise.resolve([]);
        }
        if (!storage.row || storage.row.revision !== Number(values[2])) return Promise.resolve([]);
        storage.row = { revision: Number(values[0]), state: String(values[1]) };
        return Promise.resolve([{ updated: 1 }]);
      }
      if (text.startsWith("INSERT INTO auth_consume_markers")) {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unexpected SQL: ${text}`));
    };
  }),
}));

vi.mock("@vercel/blob", () => ({
  BlobPreconditionFailedError: class extends Error {},
  get: vi.fn(async (pathname: string) => {
    if (!storage.legacyBlob) return null;
    return {
      statusCode: 200 as const,
      stream: new Response(storage.legacyBlob).body!,
      headers: new Headers(),
      blob: {
        url: `https://private.example/${pathname}`,
        downloadUrl: `https://private.example/${pathname}?download=1`,
        pathname,
        contentDisposition: "attachment",
        cacheControl: "private, no-store",
        uploadedAt: new Date(0),
        etag: "legacy-etag",
        contentType: "application/json",
        size: new TextEncoder().encode(storage.legacyBlob).byteLength,
      },
    };
  }),
  put: vi.fn(async () => {
    throw new Error("Authentication must never write to Blob storage");
  }),
}));

vi.mock("@vercel/global-config", () => ({
  createClient: vi.fn(() => ({
    get: vi.fn(async () => storage.globalAuth),
  })),
}));

import type { AuthState } from "@/lib/domain/auth";
import {
  mutateAuthState,
  readAuthState,
  StateConfigurationError,
  StateConflictError,
} from "@/lib/server/storage/state";

const connectionString = "postgresql://user:secret@ep-shy-sunset.aws.neon.tech/SEcure_Auth?sslmode=require";

function passkey(counter = 1) {
  return {
    id: "credential-one",
    publicKey: "AQID",
    counter,
    transports: ["internal" as const],
    createdAt: "2026-08-20T12:00:00.000Z",
    label: "Primary",
  };
}

function authState(overrides: Partial<AuthState> = {}): AuthState {
  return {
    schemaVersion: 2,
    state: "ACTIVE",
    revision: 0,
    administratorUserId: "administrator-id",
    sessionEpoch: 0,
    passkeys: [passkey()],
    recoveryCodeHashes: ["a".repeat(64)],
    revokedSessionHashes: [],
    ...overrides,
  };
}

function installRow(state: AuthState): void {
  storage.row = { revision: state.revision, state: JSON.stringify(state) };
}

function storedAuthState(): AuthState {
  if (!storage.row) throw new Error("Expected a seeded auth_state row");
  return JSON.parse(storage.row.state) as AuthState;
}

beforeEach(() => {
  storage.row = null;
  storage.legacyBlob = null;
  storage.globalAuth = null;
  storage.updates = 0;
  storage.conflictWriter = undefined;
  storage.repeatConflict = false;
  storage.updateFailure = null;
  storage.missingTable = false;
  storage.connectionStrings = [];

  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("WEBAUTHN_EXPECTED_ORIGIN", "https://admin.speedzonems.test");
  vi.stubEnv("WEBAUTHN_RP_ID", "speedzonems.test");
  vi.stubEnv("AUTH_DATABASE_URL", connectionString);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete (globalThis as { __speedzoneAuthDatabase?: unknown }).__speedzoneAuthDatabase;
});

describe("authoritative authentication-state storage", () => {
  it("fails closed in production when the SEcure_Auth connection is absent", async () => {
    vi.stubEnv("AUTH_DATABASE_URL", "");

    await expect(readAuthState()).rejects.toBeInstanceOf(StateConfigurationError);
  });

  it("refuses a connection string that points at another database", async () => {
    vi.stubEnv(
      "AUTH_DATABASE_URL",
      "postgresql://user:secret@ep-shy-sunset.aws.neon.tech/neondb?sslmode=require",
    );

    await expect(readAuthState()).rejects.toBeInstanceOf(StateConfigurationError);
    expect(storage.connectionStrings).toHaveLength(0);
  });

  it("requires TLS on the production connection string", async () => {
    vi.stubEnv(
      "AUTH_DATABASE_URL",
      "postgresql://user:secret@ep-shy-sunset.aws.neon.tech/SEcure_Auth",
    );

    await expect(readAuthState()).rejects.toBeInstanceOf(StateConfigurationError);
  });

  it("reports a missing schema as configuration rather than an outage", async () => {
    storage.missingTable = true;

    await expect(readAuthState()).rejects.toBeInstanceOf(StateConfigurationError);
  });

  it("keeps local auth in development when no database is configured", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_DATABASE_URL", "");
    vi.stubEnv("LOCAL_STATE_PATH", `.data/missing-${crypto.randomUUID()}.json`);
    installRow(authState({ revision: 9, sessionEpoch: 9 }));

    await expect(readAuthState()).resolves.toMatchObject({
      revision: 0,
      administratorUserId: "",
      sessionEpoch: 0,
      passkeys: [],
    });
  });

  it("seeds the SEcure_Auth row once from the legacy private Blob object", async () => {
    const legacy = authState({ revision: 7, sessionEpoch: 4 });
    vi.stubEnv("BLOB_PRIVATE_READ_WRITE_TOKEN", "private-token");
    storage.legacyBlob = `${JSON.stringify(legacy)}\n`;

    await expect(readAuthState()).resolves.toEqual(legacy);
    storage.legacyBlob = `${JSON.stringify(authState())}\n`;
    await expect(readAuthState()).resolves.toEqual(legacy);
    expect(storedAuthState()).toEqual(legacy);
  });

  it("seeds from the legacy Global Config mirror when no Blob object remains", async () => {
    const legacy = authState({ revision: 3, sessionEpoch: 2 });
    vi.stubEnv("AUTH_GLOBAL_CONFIG", "https://global-config.example/read-token");
    storage.globalAuth = legacy;

    await expect(readAuthState()).resolves.toEqual(legacy);
    expect(storedAuthState()).toEqual(legacy);
  });

  it("seeds a fresh installation as a bootstrap-ready record", async () => {
    await expect(readAuthState()).resolves.toMatchObject({
      state: "BOOTSTRAP_READY",
      revision: 0,
      passkeys: [],
    });
  });

  it("rebases a retry on the latest authoritative state when no revision was supplied", async () => {
    installRow(authState());
    storage.conflictWriter = () => {
      installRow(
        authState({
          revision: 1,
          sessionEpoch: 2,
          passkeys: [passkey(5)],
          recoveryCodeHashes: ["b".repeat(64)],
        }),
      );
    };

    const result = await mutateAuthState((current) => ({
      ...current,
      sessionEpoch: current.sessionEpoch + 1,
      passkeys: current.passkeys.map((credential) => ({
        ...credential,
        counter: credential.counter + 1,
      })),
    }));

    expect(result).toMatchObject({
      revision: 2,
      sessionEpoch: 3,
      recoveryCodeHashes: ["b".repeat(64)],
    });
    expect(result.passkeys[0]?.counter).toBe(6);
    expect(storedAuthState()).toEqual(result);
  });

  it("rejects a stale expected revision without overwriting concurrent auth changes", async () => {
    installRow(authState());
    const concurrent = authState({
      revision: 1,
      sessionEpoch: 4,
      passkeys: [passkey(9)],
      recoveryCodeHashes: ["b".repeat(64)],
      revokedSessionHashes: ["c".repeat(64)],
    });
    storage.conflictWriter = () => installRow(concurrent);

    await expect(
      mutateAuthState(
        (current) => ({
          ...current,
          sessionEpoch: 1,
          passkeys: [passkey(2)],
          recoveryCodeHashes: ["d".repeat(64)],
        }),
        0,
      ),
    ).rejects.toBeInstanceOf(StateConflictError);

    expect(storedAuthState()).toEqual(concurrent);
  });

  it("bounds repeated compare-and-swap conflicts", async () => {
    installRow(authState());
    storage.repeatConflict = true;
    storage.conflictWriter = () => {
      const current = storedAuthState();
      installRow({ ...current, revision: current.revision + 1 });
    };

    await expect(
      mutateAuthState((current) => ({ ...current, sessionEpoch: current.sessionEpoch + 1 })),
    ).rejects.toBeInstanceOf(StateConflictError);
    expect(storage.updates).toBe(5);
  });

  it.each([
    ["session epoch", (current: AuthState) => ({ ...current, sessionEpoch: 4 })],
    ["authenticator counter", (current: AuthState) => ({ ...current, passkeys: [passkey(6)] })],
  ])("refuses to move a protected %s backwards", async (_name, mutation) => {
    installRow(authState({ sessionEpoch: 5, passkeys: [passkey(7)] }));

    await expect(mutateAuthState(mutation, 0)).rejects.toBeInstanceOf(StateConflictError);
    expect(storedAuthState()).toMatchObject({ sessionEpoch: 5, passkeys: [{ counter: 7 }] });
  });

  it("fails closed without a partial activation record when the commit fails", async () => {
    const ready = authState({
      state: "BOOTSTRAP_READY",
      administratorUserId: "",
      sessionEpoch: 0,
      passkeys: [],
      recoveryCodeHashes: [],
    });
    installRow(ready);
    storage.updateFailure = new Error("simulated authoritative storage outage");

    await expect(
      mutateAuthState(
        (current) => ({
          ...current,
          state: "ACTIVE",
          administratorUserId: "activated-administrator",
          sessionEpoch: 10,
          passkeys: [passkey()],
          recoveryCodeHashes: ["d".repeat(64)],
        }),
        ready.revision,
      ),
    ).rejects.toThrow(/storage outage/);

    expect(storedAuthState()).toEqual(ready);
  });
});
