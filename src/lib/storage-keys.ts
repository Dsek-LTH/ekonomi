// Object keys for the bucket. Apart from lib/server/storage.ts because the seed cannot import server env.

// Strip directories and unsafe characters from a user-supplied filename.
export function safeName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "file";
  return base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "file";
}

// Stable, collision-free key. The receiptId (a uuid) guarantees uniqueness;
// the expenseId prefix keeps a receipt's objects grouped.
export function receiptKey(expenseId: string, receiptId: string, filename: string): string {
  return `receipts/${expenseId}/${receiptId}-${safeName(filename)}`;
}
