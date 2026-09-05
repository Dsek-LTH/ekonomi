"use client";

// A picked file that survives a reload.
//
// The other half of `useLocalDraft`. That one keeps what was typed, so the
// utlägg wizard already survives a phone locking itself mid-form; the receipt
// did not, and re-finding a photo is the one part of filling in an utlägg that
// is genuinely annoying to do twice.
//
// IndexedDB rather than localStorage, which is where the obvious answer leads
// and where it fails. localStorage holds strings, so a file has to be base64'd
// on the way in (a third larger), and the quota is about 5 MB per origin
// against an upload limit of 25 MB. A receipt photographed on a phone is
// routinely several megabytes, so the store would break on precisely the
// common case and work on the rare one. IndexedDB takes a Blob as it is and its
// quota is a share of the disk.
//
// Everything here fails quietly. A private window, a browser told to block site
// data, a full disk: the cost is one file that has to be picked again, which is
// exactly where the wizard was before this existed, and none of it is worth an
// error on the way into a form.

const DB_NAME = "utlagg";
const DB_VERSION = 1;
const STORE = "kept-files";

/**
 * How long a kept file is worth restoring.
 *
 * A day, because the thing being survived is a reload, a phone locking, a tab
 * restored after a crash. A file still sitting here a week later belongs to an
 * attempt somebody abandoned, and handing it back to a different claim is worse
 * than asking for the photo again.
 */
const KEEP_MS = 24 * 60 * 60 * 1000;

interface KeptRow {
  key: string;
  blob: Blob;
  name: string;
  type: string;
  savedAt: number;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    // Not just `typeof window`: a browser can have the API and refuse to open a
    // database (Firefox in a private window used to throw here rather than
    // fail the request), so the call itself is inside the try.
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // A version change held open by another tab. Waiting forever would hang
      // whatever awaited this, so the answer is "no store today".
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
          // Closing on completion rather than leaving it open: a held
          // connection blocks the next version change, and every call here
          // opens its own anyway.
          tx.oncomplete = () => db.close();
        } catch {
          resolve(null);
        }
      }),
  );
}

/** Keep a picked file under `key`, replacing whatever was there. */
export async function keepFile(key: string, file: File): Promise<void> {
  const row: KeptRow = {
    key,
    // The Blob, not the File: a File is a Blob with a name, and the name and
    // type are stored beside it because Safari has historically returned a
    // plain Blob from IndexedDB even when a File went in.
    blob: file.slice(0, file.size, file.type),
    name: file.name,
    type: file.type,
    savedAt: Date.now(),
  };
  await run("readwrite", (s) => s.put(row));
}

/**
 * The file kept under `key`, or null: none kept, too old, or no store at all.
 *
 * An expired row is deleted as it is passed over, so the store tidies itself
 * without anything having to sweep it on a schedule.
 */
export async function readKeptFile(key: string): Promise<File | null> {
  const row = (await run<KeptRow | undefined>("readonly", (s) => s.get(key))) ?? null;
  if (!row?.blob) return null;
  if (Date.now() - row.savedAt > KEEP_MS) {
    await dropKeptFile(key);
    return null;
  }
  try {
    return new File([row.blob], row.name, { type: row.type });
  } catch {
    return null;
  }
}

/** Forget the file kept under `key`. Called once it is somewhere safer. */
export async function dropKeptFile(key: string): Promise<void> {
  await run("readwrite", (s) => s.delete(key));
}
