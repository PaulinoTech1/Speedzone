"use client";

import { argon2id } from "hash-wasm";

const databaseName = "speedzone-encrypted-drafts";
const databaseVersion = 1;
const schemaVersion = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type VaultMeta = {
  id: "vault";
  salt: number[];
  noncePrefix: number[];
  nonceCounter: number;
  keyCheck?: number[];
};

type EncryptedDraft = {
  id: string;
  schemaVersion: 1;
  nonce: number[];
  ciphertext: ArrayBuffer;
  updatedAt: string;
};

let activeKey: CryptoKey | null = null;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolvePromise, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("meta")) database.createObjectStore("meta", { keyPath: "id" });
      if (!database.objectStoreNames.contains("drafts")) database.createObjectStore("drafts", { keyPath: "id" });
    };
    request.onsuccess = () => resolvePromise(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    request.onsuccess = () => resolvePromise(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB operation failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    transaction.oncomplete = () => resolvePromise();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

async function vaultMeta(database: IDBDatabase): Promise<VaultMeta> {
  const transaction = database.transaction("meta", "readwrite");
  const store = transaction.objectStore("meta");
  let meta = await requestResult(store.get("vault") as IDBRequest<VaultMeta | undefined>);
  if (!meta) {
    meta = {
      id: "vault",
      salt: Array.from(crypto.getRandomValues(new Uint8Array(16))),
      noncePrefix: Array.from(crypto.getRandomValues(new Uint8Array(8))),
      nonceCounter: 0,
    };
    store.add(meta);
  }
  await transactionComplete(transaction);
  return meta;
}

async function deriveVaultCheck(
  material: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    material,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode("speedzone-draft-vault-check-v1")),
  );
}

function equalBytes(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function saveVaultMeta(database: IDBDatabase, meta: VaultMeta): Promise<void> {
  const transaction = database.transaction("meta", "readwrite");
  transaction.objectStore("meta").put(meta);
  await transactionComplete(transaction);
}

export async function unlockDraftVault(passphrase: string): Promise<void> {
  if (passphrase.length < 12) throw new Error("Use a local vault passphrase of at least 12 characters");
  const database = await openDatabase();
  try {
    const meta = await vaultMeta(database);
    const material = await argon2id({
      password: passphrase,
      salt: new Uint8Array(meta.salt),
      iterations: 3,
      parallelism: 1,
      memorySize: 19_456,
      hashLength: 32,
      outputType: "binary",
    });
    const exactMaterial = Uint8Array.from(material);
    const check = await deriveVaultCheck(exactMaterial);
    if (meta.keyCheck && !equalBytes(meta.keyCheck, check)) {
      activeKey = null;
      throw new Error("The local vault passphrase is incorrect");
    }
    if (!meta.keyCheck) {
      meta.keyCheck = Array.from(check);
      await saveVaultMeta(database, meta);
    }
    activeKey = await crypto.subtle.importKey(
      "raw",
      exactMaterial,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    database.close();
  }
}

export function lockDraftVault(): void {
  // JavaScript runtimes do not provide reliable memory zeroization. Dropping
  // the only application reference is the strongest truthful guarantee here.
  activeKey = null;
}

export function isDraftVaultUnlocked(): boolean {
  return activeKey !== null;
}

function additionalData(recordId: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(encoder.encode(`speedzone-draft:v${schemaVersion}:${recordId}`));
}

async function nextNonce(database: IDBDatabase): Promise<Uint8Array<ArrayBuffer>> {
  const transaction = database.transaction("meta", "readwrite");
  const store = transaction.objectStore("meta");
  const meta = await requestResult(store.get("vault") as IDBRequest<VaultMeta | undefined>);
  if (!meta) throw new Error("The local vault has not been initialized");
  if (meta.nonceCounter >= 0xffff_ffff) throw new Error("The local vault nonce space is exhausted");
  meta.nonceCounter += 1;
  store.put(meta);
  await transactionComplete(transaction);
  const nonce = new Uint8Array(12);
  nonce.set(meta.noncePrefix, 0);
  new DataView(nonce.buffer).setUint32(8, meta.nonceCounter, false);
  return nonce;
}

export async function saveEncryptedDraft(recordId: string, value: unknown): Promise<void> {
  if (!activeKey) throw new Error("Unlock the local draft vault first");
  const database = await openDatabase();
  try {
    await vaultMeta(database);
    const nonce = await nextNonce(database);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: additionalData(recordId), tagLength: 128 },
      activeKey,
      encoder.encode(JSON.stringify(value)),
    );
    const transaction = database.transaction("drafts", "readwrite");
    const record: EncryptedDraft = {
      id: recordId,
      schemaVersion,
      nonce: Array.from(nonce),
      ciphertext,
      updatedAt: new Date().toISOString(),
    };
    transaction.objectStore("drafts").put(record);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function loadEncryptedDraft<T>(recordId: string): Promise<T | null> {
  if (!activeKey) throw new Error("Unlock the local draft vault first");
  const database = await openDatabase();
  try {
    const transaction = database.transaction("drafts", "readonly");
    const record = await requestResult(
      transaction.objectStore("drafts").get(recordId) as IDBRequest<EncryptedDraft | undefined>,
    );
    await transactionComplete(transaction);
    if (!record || record.schemaVersion !== schemaVersion) return null;
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(record.nonce),
        additionalData: additionalData(recordId),
        tagLength: 128,
      },
      activeKey,
      record.ciphertext,
    );
    return JSON.parse(decoder.decode(plaintext)) as T;
  } finally {
    database.close();
  }
}

export async function deleteEncryptedDraft(recordId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("drafts", "readwrite");
    transaction.objectStore("drafts").delete(recordId);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}
