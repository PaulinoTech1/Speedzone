type StoredValue = Record<string, unknown>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onupgradeneeded: ((event: Event) => void) | null = null;
}

class FakeTransaction {
  oncomplete: ((event: Event) => void) | null = null;
  onabort: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  error: DOMException | null = null;

  private pending = 0;
  private completed = false;

  constructor(private readonly database: FakeDatabase) {
    setTimeout(() => this.completeWhenIdle(), 0);
  }

  objectStore(name: string): FakeObjectStore {
    const records = this.database.store(name);
    return new FakeObjectStore(records, this);
  }

  request<T>(operation: () => T): IDBRequest<T> {
    const request = new FakeRequest<T>();
    this.pending += 1;
    queueMicrotask(() => {
      try {
        request.result = operation();
        request.onsuccess?.(new Event("success"));
      } catch (error) {
        request.error = error instanceof DOMException
          ? error
          : new DOMException("IndexedDB request failed", "UnknownError");
        this.error = request.error;
        request.onerror?.(new Event("error"));
        this.onerror?.(new Event("error"));
      } finally {
        this.pending -= 1;
        setTimeout(() => this.completeWhenIdle(), 0);
      }
    });
    return request as unknown as IDBRequest<T>;
  }

  private completeWhenIdle(): void {
    if (this.completed || this.pending > 0) return;
    if (!this.oncomplete) {
      setTimeout(() => this.completeWhenIdle(), 0);
      return;
    }
    this.completed = true;
    this.oncomplete(new Event("complete"));
  }
}

class FakeObjectStore {
  constructor(
    private readonly records: Map<IDBValidKey, StoredValue>,
    private readonly transaction: FakeTransaction,
  ) {}

  get(key: IDBValidKey): IDBRequest<StoredValue | undefined> {
    return this.transaction.request(() => {
      const value = this.records.get(key);
      return value ? clone(value) : undefined;
    });
  }

  add(value: StoredValue): IDBRequest<IDBValidKey> {
    return this.transaction.request(() => {
      const key = value.id as IDBValidKey;
      if (this.records.has(key)) throw new DOMException("Key already exists", "ConstraintError");
      this.records.set(key, clone(value));
      return key;
    });
  }

  put(value: StoredValue): IDBRequest<IDBValidKey> {
    return this.transaction.request(() => {
      const key = value.id as IDBValidKey;
      this.records.set(key, clone(value));
      return key;
    });
  }

  delete(key: IDBValidKey): IDBRequest<undefined> {
    return this.transaction.request(() => {
      this.records.delete(key);
      return undefined;
    });
  }
}

class FakeDatabase {
  private readonly stores = new Map<string, Map<IDBValidKey, StoredValue>>();

  readonly objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };

  createObjectStore(name: string): IDBObjectStore {
    const records = new Map<IDBValidKey, StoredValue>();
    this.stores.set(name, records);
    return {} as IDBObjectStore;
  }

  transaction(): IDBTransaction {
    return new FakeTransaction(this) as unknown as IDBTransaction;
  }

  store(name: string): Map<IDBValidKey, StoredValue> {
    const records = this.stores.get(name);
    if (!records) throw new DOMException(`Object store ${name} does not exist`, "NotFoundError");
    return records;
  }

  close(): void {}
}

export class FakeIndexedDbFactory {
  private readonly databases = new Map<string, FakeDatabase>();

  open(name: string): IDBOpenDBRequest {
    const request = new FakeRequest<FakeDatabase>();
    queueMicrotask(() => {
      let database = this.databases.get(name);
      const isNew = !database;
      if (!database) {
        database = new FakeDatabase();
        this.databases.set(name, database);
      }
      request.result = database;
      if (isNew) request.onupgradeneeded?.(new Event("upgradeneeded"));
      request.onsuccess?.(new Event("success"));
    });
    return request as unknown as IDBOpenDBRequest;
  }

  read(store: string, key: IDBValidKey): StoredValue | undefined {
    const database = this.databases.get("speedzone-encrypted-drafts");
    const value = database?.store(store).get(key);
    return value ? clone(value) : undefined;
  }

  write(store: string, value: StoredValue): void {
    const database = this.databases.get("speedzone-encrypted-drafts");
    if (!database) throw new Error("Draft database has not been opened");
    database.store(store).set(value.id as IDBValidKey, clone(value));
  }
}
