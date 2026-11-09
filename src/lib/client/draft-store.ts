// Temporary, tab/account-scoped recovery. Never stores credentials or uploads to a server.
export const DRAFT_TTL = 12 * 60 * 60 * 1000;
export type DraftRecord<T = unknown> = { key: string; owner: string; tab: string; scope: string; expiresAt: number; value: T };
const databaseName = "delivery-edit-recovery-v1";
const memory = new Map<string, DraftRecord>();
const fileBytes = new WeakMap<File, Promise<ArrayBuffer>>();
let database: Promise<IDBDatabase> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let fallbackTab: string | undefined;

// Some WebKit versions reject Blob/File writes in IndexedDB. Store original
// bytes plus metadata and reconstruct File on read, without re-encoding images.
async function pack(value: unknown): Promise<unknown> {
  if (value instanceof File) {
    // WebKit can invalidate the original File backing data after its preview URL
    // is released. Read it once, while live, and recover using fresh File objects.
    let bytes = fileBytes.get(value);
    if (!bytes) { bytes = value.arrayBuffer(); fileBytes.set(value, bytes); }
    return { __deliveryFile: 1, bytes: await bytes, name: value.name, type: value.type, lastModified: value.lastModified };
  }
  if (Array.isArray(value)) return Promise.all(value.map(pack));
  if (value && typeof value === "object" && !(value instanceof ArrayBuffer)) {
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await pack(item)])));
  }
  return value;
}
function unpack(value: unknown): unknown {
  if (!value || typeof value !== "object" || value instanceof File || value instanceof ArrayBuffer) return value;
  const item = value as { __deliveryFile?: number; bytes?: ArrayBuffer; name?: string; type?: string; lastModified?: number };
  if (item.__deliveryFile === 1 && item.bytes instanceof ArrayBuffer && typeof item.name === "string") {
    const file = new File([item.bytes], item.name, { type: item.type, lastModified: item.lastModified });
    fileBytes.set(file, Promise.resolve(item.bytes));
    return file;
  }
  if (Array.isArray(value)) return value.map(unpack);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
}

export function draftTab() {
  try {
    let tab = sessionStorage.getItem("recovery-tab");
    if (!tab) { tab = crypto.randomUUID(); sessionStorage.setItem("recovery-tab", tab); }
    return tab;
  } catch { return fallbackTab ??= crypto.randomUUID(); }
}
export function draftKey(owner: string, tab: string, scope: string) { return JSON.stringify([owner, tab, scope]); }
export function validDraft(record: DraftRecord | undefined, owner: string, tab: string, now = Date.now()) {
  return !!record && record.owner === owner && record.tab === tab && record.expiresAt > now;
}
function open() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "key" });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error("恢复副本存储被其他窗口占用")); };
  });
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode), request = run(tx.objectStore("drafts"));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error("恢复副本存储失败"));
  });
}
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation);
  queue = next.catch(() => {});
  return next;
}
export async function readDraft<T>(owner: string, tab: string, scope: string): Promise<DraftRecord<T> | null> {
  await queue;
  const key = draftKey(owner, tab, scope);
  const stored = memory.get(key) || await transaction<DraftRecord | undefined>("readonly", store => store.get(key));
  if (!validDraft(stored, owner, tab)) return null;
  memory.set(key, stored!);
  return { ...stored!, value: unpack(stored!.value) } as DraftRecord<T>;
}
export function writeDraft<T>(owner: string, tab: string, scope: string, value: T) {
  const record: DraftRecord<T> = { key: draftKey(owner, tab, scope), owner, tab, scope, value, expiresAt: Date.now() + DRAFT_TTL };
  return serial(async () => {
    const stored = { ...record, value: await pack(record.value) };
    memory.set(stored.key, stored);
    return transaction("readwrite", store => store.put(stored));
  });
}
export function deleteDraft(owner: string, tab: string, scope: string) {
  const key = draftKey(owner, tab, scope);
  return serial(() => { memory.delete(key); return transaction("readwrite", store => store.delete(key)); });
}
export async function listDrafts(owner: string, tab: string) {
  await queue;
  return (await transaction<DraftRecord[]>("readonly", store => store.getAll())).filter(record => validDraft(record, owner, tab));
}
export function clearDrafts(owner: string, expiredOnly = false) {
  return serial(async () => {
    for (const [key, record] of memory) if ((!expiredOnly && record.owner === owner) || record.expiresAt <= Date.now()) memory.delete(key);
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite"), cursor = tx.objectStore("drafts").openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const record = row.value as DraftRecord;
        if ((!expiredOnly && record.owner === owner) || record.expiresAt <= Date.now()) row.delete();
        row.continue();
      };
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
    });
  });
}
