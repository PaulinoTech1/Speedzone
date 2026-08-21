import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  blobBody: null as string | null,
  blobEtag: null as string | null,
  etagSequence: 0,
  globalAuth: null as unknown,
  mirrorWrites: [] as unknown[],
  mirrorFails: false,
  authoritativeWriteFails: false,
  conditionalWrites: 0,
  conflictWriter: undefined as (() => void) | undefined,
  repeatConflict: false,
}));

vi.mock("@vercel/blob", () => {
  class BlobPreconditionFailedError extends Error {}

  return {
    BlobPreconditionFailedError,
    get: vi.fn(async (pathname: string) => {
      if (!storage.blobBody || !storage.blobEtag) return null;
      return {
        statusCode: 200 as const,
        stream: new Response(storage.blobBody).body!,
        headers: new Headers(),
        blob: {
          url: `https://private.example/${pathname}`,
          downloadUrl: `https://private.example/${pathname}?download=1`,
          pathname,
          contentDisposition: "attachment",
          cacheControl: "private, no-store",
          uploadedAt: new Date(0),
          etag: storage.blobEtag,
          contentType: "application/json",
          size: new TextEncoder().encode(storage.blobBody).byteLength,
        },
      };
    }),
    put: vi.fn(
      async (
        pathname: string,
        body: unknown,
        options: { allowOverwrite?: boolean; ifMatch?: string },
      ) => {
        if (!options.allowOverwrite && storage.blobBody) {
          throw new BlobPreconditionFailedError();
        }
        if (options.ifMatch) {
          if (storage.authoritativeWriteFails) {
            throw new Error("simulated authoritative storage outage");
          }
          storage.conditionalWrites += 1;
          if (storage.conflictWriter) {
            const writer = storage.conflictWriter;
            if (!storage.repeatConflict) storage.conflictWriter = undefined;
            writer();
            throw new BlobPreconditionFailedError();
          }
          if (options.ifMatch !== storage.blobEtag) {
            throw new BlobPreconditionFailedError();
          }
        }
        storage.blobBody = String(body);
        storage.blobEtag = `etag-${++storage.etagSequence}`;
        return {
          url: `https://private.example/${pathname}`,
          downloadUrl: `https://private.example/${pathname}?download=1`,
          pathname,
          contentType: "application/json",
          contentDisposition: "attachment",
          etag: storage.blobEtag,
        };
      },
    ),
  };
});

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

function installBlob(state: AuthState): void {
  storage.blobBody = `${JSON.stringify(state)}\n`;
  storage.blobEtag = `etag-${++storage.etagSequence}`;
}

function storedAuthState(): AuthState {
  if (!storage.blobBody) throw new Error("Expected a simulated auth-state Blob");
  return JSON.parse(storage.blobBody) as AuthState;
}

beforeEach(() => {
  storage.blobBody = null;
  storage.blobEtag = null;
  storage.etagSequence = 0;
  storage.globalAuth = null;
  storage.mirrorWrites = [];
  storage.mirrorFails = false;
  storage.authoritativeWriteFails = false;
  storage.conditionalWrites = 0;
  storage.conflictWriter = undefined;
  storage.repeatConflict = false;

  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("WEBAUTHN_EXPECTED_ORIGIN", "https://admin.speedzonems.test");
  vi.stubEnv("WEBAUTHN_RP_ID", "speedzonems.test");
  vi.stubEnv("BLOB_PRIVATE_READ_WRITE_TOKEN", "private-token");
  vi.stubEnv("AUTH_GLOBAL_CONFIG", "https://global-config.example/read-token");
  vi.stubEnv("AUTH_GLOBAL_CONFIG_ID", "config-id");
  vi.stubEnv("GLOBAL_CONFIG_API_TOKEN", "api-token");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (_input, init) => {
      if (storage.mirrorFails) return new Response(null, { status: 503 });
      const payload = JSON.parse(String(init?.body)) as {
        items: Array<{ operation: string; key: string; value?: unknown }>;
      };
      const update = payload.items.find((item) => item.key === "auth_state_v1");
      if (update?.operation === "upsert") {
        storage.globalAuth = update.value;
        storage.mirrorWrites.push(update.value);
      }
      return new Response(null, { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("authoritative authentication-state storage", () => {
  it("fails closed in production when the private auth Blob token is absent", async () => {
    vi.stubEnv("BLOB_PRIVATE_READ_WRITE_TOKEN", "");

    await expect(readAuthState()).rejects.toBeInstanceOf(StateConfigurationError);
  });

  it("fails closed in production when the auth read mirror is absent", async () => {
    vi.stubEnv("AUTH_GLOBAL_CONFIG", "");

    await expect(readAuthState()).rejects.toBeInstanceOf(StateConfigurationError);
  });

  it("keeps local auth in development when the private token is only used for photos", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_GLOBAL_CONFIG", "");
    vi.stubEnv("AUTH_GLOBAL_CONFIG_ID", "");
    vi.stubEnv("LOCAL_STATE_PATH", `.data/missing-${crypto.randomUUID()}.json`);
    installBlob(authState({ revision: 9, sessionEpoch: 9 }));

    await expect(readAuthState()).resolves.toMatchObject({
      revision: 0,
      administratorUserId: "",
      sessionEpoch: 0,
      passkeys: [],
    });
  });

  it("seeds the private Blob once from the Global Config migration mirror", async () => {
    const legacy = authState({ revision: 7, sessionEpoch: 4 });
    storage.globalAuth = legacy;

    await expect(readAuthState()).resolves.toEqual(legacy);
    storage.globalAuth = authState();
    await expect(readAuthState()).resolves.toEqual(legacy);
    expect(storedAuthState()).toEqual(legacy);
  });

  it("rebases a retry on the latest authoritative state when no revision was supplied", async () => {
    installBlob(authState());
    storage.conflictWriter = () => {
      installBlob(
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
    expect(storage.globalAuth).toEqual(result);
  });

  it("rejects a stale expected revision without overwriting concurrent auth changes", async () => {
    installBlob(authState());
    const concurrent = authState({
      revision: 1,
      sessionEpoch: 4,
      passkeys: [passkey(9)],
      recoveryCodeHashes: ["b".repeat(64)],
      revokedSessionHashes: ["c".repeat(64)],
    });
    storage.conflictWriter = () => installBlob(concurrent);

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
    expect(storage.mirrorWrites).toHaveLength(0);
  });

  it("bounds repeated conditional-write conflicts", async () => {
    installBlob(authState());
    storage.repeatConflict = true;
    storage.conflictWriter = () => {
      const current = storedAuthState();
      installBlob({ ...current, revision: current.revision + 1 });
    };

    await expect(
      mutateAuthState((current) => ({ ...current, sessionEpoch: current.sessionEpoch + 1 })),
    ).rejects.toBeInstanceOf(StateConflictError);
    expect(storage.conditionalWrites).toBe(5);
  });

  it.each([
    ["session epoch", (current: AuthState) => ({ ...current, sessionEpoch: 4 })],
    [
      "authenticator counter",
      (current: AuthState) => ({ ...current, passkeys: [passkey(6)] }),
    ],
  ])("refuses to move a protected %s backwards", async (_name, mutation) => {
    installBlob(authState({ sessionEpoch: 5, passkeys: [passkey(7)] }));

    await expect(mutateAuthState(mutation, 0)).rejects.toBeInstanceOf(StateConflictError);
    expect(storedAuthState()).toMatchObject({ sessionEpoch: 5, passkeys: [{ counter: 7 }] });
  });

  it("keeps an authoritative commit successful when the read mirror is unavailable", async () => {
    installBlob(authState());
    storage.mirrorFails = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await mutateAuthState(
      (current) => ({ ...current, sessionEpoch: current.sessionEpoch + 1 }),
      0,
    );

    expect(storedAuthState()).toEqual(result);
    expect(result).toMatchObject({ revision: 1, sessionEpoch: 1 });
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("fails closed without a partial activation record when the authoritative write fails", async () => {
    const ready = authState({
      state: "BOOTSTRAP_READY",
      administratorUserId: "",
      sessionEpoch: 0,
      passkeys: [],
      recoveryCodeHashes: [],
    });
    installBlob(ready);
    storage.authoritativeWriteFails = true;

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
    expect(storage.mirrorWrites).toHaveLength(0);
  });
});
