"use client";

// Picked files that survive a reload.
//
// The other half of `useLocalDraft`. That one keeps what was typed, so the
// utlägg wizard already survives a phone locking itself mid-form; a receipt
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
// Several files under one draft, not one: a submitter filling in a claim that
// needs two complementing documents picks them together or one after another, and the
// second used to bump the first out of the browser's own memory of the
// draft. Each is keyed `${draftKey}::${fileId}`, and the draft key alone
// (never containing "::" itself, see keepFile) bounds an IndexedDB range that
// lists every file still kept for it without the caller enumerating their ids
// first, which matters after a reload: the wizard's own state is gone, and
// this store is the only place that still knows which files were picked.
//
// Everything here fails quietly. A private window, a browser told to block site
// data, a full disk: the cost is one file that has to be picked again, which is
// exactly where the wizard was before this existed, and none of it is worth an
// error on the way into a form.

const DB_NAME = "utlagg";
const DB_VERSION = 1;
const STORE = "kept-files";

/** Joins a draft key and a file id into the store's primary key. Files keyed
 *  under `key` are found again by ranging over every row starting with
 *  `${key}${SEP}`, which is why `key` itself must never contain `SEP`: every
 *  draft key in this app is a fixed literal or a plain id, neither of which
 *  does. */
const SEP = "::";
const rowKey = (key: string, fileId: string) => `${key}${SEP}${fileId}`;

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
  key: string; // `${draftKey}::${fileId}`, this store's primary key
  blob: Blob;
  name: string;
  type: string;
  savedAt: number;
  /** Breaks ties in `savedAt`. Several files picked at once are kept in the
   *  same millisecond, and without this they came back after a reload in key
   *  order, which is the order of their random ids. Absent on rows written
   *  before it existed, which sort as 0. */
  seq?: number;
}

// Counts up for as long as the page lives. Only ever compared between rows
// with the same `savedAt`, and those were all written by this same page.
let seq = 0;

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

/** Keep a picked file under `key` and `fileId`, replacing whatever was kept
 *  under that same pair. Several files can share a `key`; each needs its own
 *  `fileId` (the caller's choice, e.g. `crypto.randomUUID()`) or one replaces
 *  another instead of standing beside it. */
export async function keepFile(key: string, fileId: string, file: File): Promise<void> {
  const row: KeptRow = {
    key: rowKey(key, fileId),
    // The Blob, not the File: a File is a Blob with a name, and the name and
    // type are stored beside it because Safari has historically returned a
    // plain Blob from IndexedDB even when a File went in.
    blob: file.slice(0, file.size, file.type),
    name: file.name,
    type: file.type,
    savedAt: Date.now(),
    seq: seq++,
  };
  await run("readwrite", (s) => s.put(row));
}

/** One row read back as the File it was kept from, or null for a row too old
 *  to restore (see KEEP_MS) or too damaged a Blob to rebuild one from. */
function toFile(row: KeptRow): File | null {
  if (Date.now() - row.savedAt > KEEP_MS) return null;
  try {
    return new File([row.blob], row.name, { type: row.type });
  } catch {
    return null;
  }
}

/**
 * Every file still kept under `key`, oldest first: what a reload has to work
 * with, since the wizard's own memory of which ones it picked did not survive
 * it. A row too old to restore is dropped as it is found, so the store tidies
 * itself without anything having to sweep it on a schedule.
 */
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

/** Forget the one file kept under `key` and `fileId`. Called once it is
 *  somewhere safer, or once the reader no longer wants it. */
export async function dropKeptFile(key: string, fileId: string): Promise<void> {
  await run("readwrite", (s) => s.delete(rowKey(key, fileId)));
}

/** Forget every file kept under `key`. Called once the draft itself is spent. */
export async function dropKeptFiles(key: string): Promise<void> {
  const range = IDBKeyRange.bound(rowKey(key, ""), rowKey(key, "￿"));
  await run("readwrite", (s) => s.delete(range));
}
