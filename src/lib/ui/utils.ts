// Tiny class-name joiner so styling stays consistent without extra deps.
export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// Client-side id for rows that only exist in a form until they're saved.
// crypto.randomUUID is unavailable on insecure origins, hence the fallback.
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
