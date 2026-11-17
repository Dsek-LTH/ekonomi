"use client";

// Settings save with one Spara at the bottom of the page (docs/settings.md). Every value a page edits is held as a
// draft until then: `useDraft` for one record's fields, `useDraftRows` for a field in each row of a list. A part of
// the page that holds a draft registers it with `useDraftPart`, and `SettingsForm` gathers the parts: one bar, one
// Spara for all of them, and a warning before leaving with anything unsaved.
//
// Adding or deleting a row, connecting and syncing are not values, and still happen at once.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import { useConfirm } from "@/components/confirm-dialog";
import { useNotify } from "@/components/shell/notifications";
import { useProgressRouter } from "@/components/shell/route-progress";
import { useLeaveGuard } from "@/components/shell/use-leave-guard";
import { Button } from "@/components/ui/button";

// ── Drafts ────────────────────────────────────────────────────────

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One record's fields as a draft over what the server holds. A refresh from elsewhere on the page (a row added, say)
 * moves the base and keeps what was typed.
 */
export function useDraft<T extends Record<string, unknown>>(server: T) {
  const [base, setBase] = useState(server);
  const [seen, setSeen] = useState(server);
  // By value: callers build the object inline, so it is a new one on every render.
  if (seen !== server && !same(seen, server)) {
    setSeen(server);
    setBase(server);
  }
  const [patch, setPatch] = useState<Partial<T>>({});

  const changes = Object.fromEntries(
    Object.entries(patch).filter(([k, v]) => !same(v, base[k])),
  ) as Partial<T>;
  const value = { ...base, ...patch } as T;

  return {
    value,
    changes,
    dirty: Object.keys(changes).length > 0,
    set: <K extends keyof T>(key: K, v: T[K]) => setPatch((p) => ({ ...p, [key]: v })),
    /** After a save: what was typed is what the server holds now, until the refresh brings it. */
    commit: () => {
      setBase(value);
      setPatch({});
    },
    reset: () => setPatch({}),
  };
}

/** A draft per row of a list, keyed by the row's id: the changed fields of each changed row. */
export function useDraftRows<R extends { id: string }>(rows: readonly R[]) {
  const [patches, setPatches] = useState<Record<string, Partial<R>>>({});
  const [committed, setCommitted] = useState<Record<string, Partial<R>>>({});
  const [seen, setSeen] = useState(rows);
  if (seen !== rows && !same(seen, rows)) {
    setSeen(rows);
    setCommitted({});
  }

  const byId = new Map(rows.map((r) => [r.id, { ...r, ...committed[r.id] }]));
  const changes: [string, Partial<R>][] = [];
  for (const [id, patch] of Object.entries(patches)) {
    const row = byId.get(id);
    if (!row) continue;
    const changed = Object.fromEntries(
      Object.entries(patch).filter(([k, v]) => !same(v, row[k as keyof R])),
    ) as Partial<R>;
    if (Object.keys(changed).length > 0) changes.push([id, changed]);
  }

  return {
    /** The row as the reader sees it, draft included. */
    get: (row: R): R => ({ ...row, ...committed[row.id], ...patches[row.id] }),
    changes,
    dirty: changes.length > 0,
    set: (id: string, patch: Partial<R>) =>
      setPatches((p) => ({ ...p, [id]: { ...p[id], ...patch } })),
    commit: () => {
      setCommitted((c) => {
        const next = { ...c };
        for (const [id, patch] of Object.entries(patches)) next[id] = { ...next[id], ...patch };
        return next;
      });
      setPatches({});
    },
    reset: () => setPatches({}),
  };
}

// ── The form ──────────────────────────────────────────────────────

/** What a part of the page hands the form: whether it has changes, and how to save and forget them. */
export interface DraftPart {
  dirty: boolean;
  /** Send the changes. False when a request failed (the failure has been shown already). */
  save: () => Promise<boolean>;
  /** After a save that went through. */
  commit: () => void;
  /** Ångra: drop the changes. */
  reset: () => void;
}

interface Registry {
  setDirty: (id: string, dirty: boolean) => void;
  setPart: (id: string, part: DraftPart | null) => void;
}

const FormCtx = createContext<Registry | null>(null);

/** Hand this part's draft to the page's SettingsForm. */
export function useDraftPart(part: DraftPart) {
  const form = useContext(FormCtx);
  if (!form) throw new Error("useDraftPart must be used within SettingsForm");
  const id = useId();

  // The latest functions, without re-registering on every render.
  useLayoutEffect(() => {
    form.setPart(id, part);
  });
  useEffect(
    () => () => {
      form.setPart(id, null);
      form.setDirty(id, false);
    },
    [form, id],
  );
  useEffect(() => form.setDirty(id, part.dirty), [form, id, part.dirty]);
}

/** Where the overlay wants the save bar: the bottom of its scrolling column. Null outside the overlay. */
export const SettingsFooterSlot = createContext<HTMLElement | null>(null);

/** Whether the open settings page has unsaved changes, for the overlay's own close (Escape, the backdrop). */
export const SettingsDirtyCtx = createContext<((dirty: boolean) => void) | null>(null);

/** The page's draft parts, and the bar with Spara under them. */
export function SettingsForm({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common.settingsForm");
  const notify = useNotify();
  const router = useProgressRouter();
  const reportDirty = useContext(SettingsDirtyCtx);
  const footerSlot = useContext(SettingsFooterSlot);

  const parts = useRef(new Map<string, DraftPart>());
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Made once: the parts call it from their effects, and a new one each render would re-register them all.
  const [registry] = useState<Registry>(() => ({
    setPart: (id, part) => {
      if (part) parts.current.set(id, part);
      else parts.current.delete(id);
    },
    setDirty: (id, dirty) =>
      setDirtyIds((now) => {
        if (now.has(id) === dirty) return now;
        const next = new Set(now);
        if (dirty) next.add(id);
        else next.delete(id);
        return next;
      }),
  }));

  const dirty = dirtyIds.size > 0;
  useLeaveGuard(dirty);
  useEffect(() => {
    reportDirty?.(dirty);
    return () => reportDirty?.(false);
  }, [dirty, reportDirty]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const dirtyParts = [...parts.current.values()].filter((p) => p.dirty);
      // One at a time: two changes on one record must not race each other.
      const saved: DraftPart[] = [];
      for (const part of dirtyParts) {
        if (!(await part.save())) break;
        saved.push(part);
      }
      for (const part of saved) part.commit();
      if (saved.length > 0) router.refresh();
      if (saved.length === dirtyParts.length) notify.success(t("saved"));
    } finally {
      setSaving(false);
    }
  }, [notify, router, t]);

  const reset = () => {
    for (const part of parts.current.values()) part.reset();
  };

  // A fixed height, the same as the overlay's header, at the foot of the overlay (its footer slot) whatever the
  // page's length. Outside the overlay it simply follows the page.
  const bar = (
    <div className="flex h-14 items-center justify-end gap-2 border-t border-border bg-background px-4 sm:px-8">
      {dirty && <p className="mr-auto truncate text-sm text-muted">{t("unsaved")}</p>}
      <Button variant="secondary" size="sm" disabled={!dirty || saving} onClick={reset}>
        {t("reset")}
      </Button>
      <Button size="sm" disabled={!dirty} loading={saving} onClick={save}>
        {t("save")}
      </Button>
    </div>
  );

  return (
    <FormCtx.Provider value={registry}>
      {children}
      {footerSlot ? createPortal(bar, footerSlot) : bar}
    </FormCtx.Provider>
  );
}

/** For the overlay: ask before closing it with changes unsaved. */
export function useConfirmLeave() {
  const t = useTranslations("common.leaveGuard");
  const confirm = useConfirm();
  return () =>
    confirm({ title: t("title"), message: t("message"), confirmLabel: t("leave"), tone: "danger" });
}
