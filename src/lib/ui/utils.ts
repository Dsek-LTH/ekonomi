export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// Client-side id for unsaved rows. randomUUID is unavailable on insecure origins, hence the fallback.
export const uid = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
