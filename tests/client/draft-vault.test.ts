import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeIndexedDbFactory } from "../helpers/fake-indexed-db";

type RawDraft = {
  id: string;
  schemaVersion: 1;
  nonce: number[];
  ciphertext: ArrayBuffer;
  updatedAt: string;
};

describe("encrypted local draft vault", () => {
  let database: FakeIndexedDbFactory;

  beforeEach(() => {
    database = new FakeIndexedDbFactory();
    vi.stubGlobal("indexedDB", database);
  });

  afterEach(async () => {
    const vault = await import("@/lib/client/draft-vault");
    vault.lockDraftVault();
    vi.unstubAllGlobals();
  });

  it("uses authenticated AES-GCM records, unique nonces, and a memory-only key", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const vault = await import("@/lib/client/draft-vault");
    const passphrase = "correct local vault passphrase";
    const secretDescription = "private draft value <script>alert(1)</script>";

    await expect(vault.unlockDraftVault("too short")).rejects.toThrow(/at least 12/i);
    await vault.unlockDraftVault(passphrase);
    expect(vault.isDraftVaultUnlocked()).toBe(true);

    await vault.saveEncryptedDraft("vehicle-1", {
      description: secretDescription,
      mileage: 10_000,
    });
    const first = database.read("drafts", "vehicle-1") as RawDraft;
    const firstCiphertext = [...new Uint8Array(first.ciphertext)];
    expect(first.nonce).toHaveLength(12);
    expect(new TextDecoder().decode(first.ciphertext)).not.toContain(secretDescription);

    await vault.saveEncryptedDraft("vehicle-1", {
      description: secretDescription,
      mileage: 10_001,
    });
    const second = database.read("drafts", "vehicle-1") as RawDraft;
    expect(second.nonce).toHaveLength(12);
    expect(second.nonce).not.toEqual(first.nonce);
    expect([...new Uint8Array(second.ciphertext)]).not.toEqual(firstCiphertext);

    const meta = database.read("meta", "vault") as {
      salt: number[];
      noncePrefix: number[];
      nonceCounter: number;
      keyCheck: number[];
    };
    expect(meta.salt).toHaveLength(16);
    expect(meta.noncePrefix).toHaveLength(8);
    expect(meta.nonceCounter).toBe(2);
    expect(meta.keyCheck).toHaveLength(32);

    database.write("drafts", { ...second, id: "vehicle-2" });
    await expect(vault.loadEncryptedDraft("vehicle-2")).rejects.toThrow();

    vault.lockDraftVault();
    expect(vault.isDraftVaultUnlocked()).toBe(false);
    await expect(vault.loadEncryptedDraft("vehicle-1")).rejects.toThrow(/unlock/i);

    const beforeWrongPassphrase = database.read("drafts", "vehicle-1") as RawDraft;
    await expect(vault.unlockDraftVault("incorrect local vault passphrase")).rejects.toThrow(
      /incorrect/i,
    );
    expect(vault.isDraftVaultUnlocked()).toBe(false);
    expect([
      ...new Uint8Array((database.read("drafts", "vehicle-1") as RawDraft).ciphertext),
    ]).toEqual([...new Uint8Array(beforeWrongPassphrase.ciphertext)]);

    await vault.unlockDraftVault(passphrase);
    await expect(vault.loadEncryptedDraft("vehicle-1")).resolves.toEqual({
      description: secretDescription,
      mileage: 10_001,
    });

    const tampered = database.read("drafts", "vehicle-1") as RawDraft;
    const damagedCiphertext = new Uint8Array(tampered.ciphertext.slice(0));
    damagedCiphertext[0] = (damagedCiphertext[0] ?? 0) ^ 1;
    database.write("drafts", { ...tampered, ciphertext: damagedCiphertext.buffer });
    await expect(vault.loadEncryptedDraft("vehicle-1")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 20_000);
});
