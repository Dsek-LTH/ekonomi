"use client";

// Picked files that survive a reload. IndexedDB, not localStorage: its ~5 MB quota is below the
// 25 MB upload limit and a file would need base64. Rows are keyed `${draftKey}::${fileId}` so a
// range scan lists a draft's files. Failures are swallowed: the cost is re-picking the file.

// Old project name, kept so files already stored are not orphaned.
const DB_NAME = "utlagg";
const DB_VERSION = 1;
const STORE = "kept-files";

/** Joins draft key and file id into the primary key. `key` must never contain SEP (range scans rely on it). */
const SEP = "::";
const rowKey = (key: string, fileId: string) => `${key}${SEP}${fileId}`;

/** How long a kept file is worth restoring: a day covers reloads, not abandoned attempts. */
const KEEP_MS = 24 * 60 * 60 * 1000;

interface KeptRow {
  key: string; // `${draftKey}::${fileId}`, this store's primary key
  blob: Blob;
  name: string;
  type: string;
  savedAt: number;
  /** Breaks ties in `savedAt` for files kept in the same millisecond; absent on old rows (sorts as 0). */
  seq?: number;
}

let seq = 0;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    // Firefox private windows can throw on open, so the call stays inside the try.
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // Blocked by another tab's open connection: give up rather than hang.
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Run one transaction, resolving to null on any failure. */
function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(STORE, mode);
          const req = body(tx.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
          // Close on completion: an open connection blocks the next version change.
          tx.oncomplete = () => db.close();
        } catch {
          resolve(null);
        }
      }),
  );
}

/** Keeps a file under `key` and `fileId`; files sharing a `key` need distinct `fileId`s. */
export async function keepFile(key: string, fileId: string, file: File): Promise<void> {
  const row: KeptRow = {
    key: rowKey(key, fileId),
    // Store name and type beside the Blob: Safari may return a plain Blob.
    blob: file.slice(0, file.size, file.type),
    name: file.name,
    type: file.type,
    savedAt: Date.now(),
    seq: seq++,
  };
  await run("readwrite", (s) => s.put(row));
}

/** Reads one row back as a File, or null if expired (KEEP_MS) or unreadable. */
function toFile(row: KeptRow): File | null {
  if (Date.now() - row.savedAt > KEEP_MS) return null;
  try {
    return new File([row.blob], row.name, { type: row.type });
  } catch {
    return null;
  }
}

/** Every file still kept under `key`, oldest first. Expired rows are dropped as found. */
export async function readKeptFiles(key: string): Promise<{ id: string; file: File }[]> {
  const range = IDBKeyRange.bound(rowKey(key, ""), rowKey(key, "￿"));
  const rows = (await run<KeptRow[]>("readonly", (s) => s.getAll(range))) ?? [];
  const out: { id: string; file: File }[] = [];
  for (const row of rows.sort((a, b) => a.savedAt - b.savedAt || (a.seq ?? 0) - (b.seq ?? 0))) {
    const file = toFile(row);
    if (file) {
      out.push({ id: row.key.slice(key.length + SEP.length), file });
    } else {
      await run("readwrite", (s) => s.delete(row.key));
    }
  }
  return out;
}

/** Forget one kept file. */
export async function dropKeptFile(key: string, fileId: string): Promise<void> {
  await run("readwrite", (s) => s.delete(rowKey(key, fileId)));
}

export async function dropKeptFiles(key: string): Promise<void> {
  const range = IDBKeyRange.bound(rowKey(key, ""), rowKey(key, "￿"));
  await run("readwrite", (s) => s.delete(range));
}
