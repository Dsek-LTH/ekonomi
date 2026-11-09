"use client";

// Ticking rows on a budget sheet and copying them elsewhere (ticks, ⌘C/⌘V, and the clipboard
// the page holds between sheets). Rows go to the server by id: the paste route also re-points
// equations inside a copied block at the copies.
import { useEffect, useRef, useState } from "react";

import type { Account, BudgetClip, LineItem } from "./budget-types";

interface SheetSelection {
  accounts: string[];
  rows: string[];
}

export function useSheetClipboard({
  accounts,
  linesOf,
  clip,
  onCopy,
  canPaste,
  onPaste,
  sheetRef,
  isEditing,
  notify,
  t,
}: {
  accounts: Account[];
  linesOf: (account: Account) => LineItem[];
  clip: BudgetClip | null;
  onCopy: (clip: BudgetClip | null) => void;
  canPaste: boolean;
  /** Send the paste, given the clipboard and the account the caret is in (null if none: rows must land in an account). */
  onPaste: (clip: BudgetClip, accountId: string | null) => void | Promise<unknown>;
  /** The sheet's element, to tell whether a focused text field is one of its cells. */
  sheetRef: React.RefObject<HTMLElement | null>;
  /** Whether a cell is being edited now. Read when a key arrives, since the listener outlives a render. */
  isEditing: () => boolean;
  notify: { success: (m: string) => void; info: (m: string) => void };
  t: (key: string, values?: Record<string, number>) => string;
}) {
  /** What is ticked. Kept across sheets on purpose: copying a block between cost centres is the point. */
  const [ticked, setTicked] = useState<{ rows: Set<string>; accounts: Set<string> }>({
    rows: new Set(),
    accounts: new Set(),
  });

  const toggle = (kind: "rows" | "accounts", id: string) =>
    setTicked((was) => {
      const next = new Set(was[kind]);
      if (!next.delete(id)) next.add(id);
      return { ...was, [kind]: next };
    });

  const clearTicks = () => setTicked({ rows: new Set(), accounts: new Set() });

  /** What is ticked on this sheet, in drawing order (the paste order). Ticks outlive the sheet, so other sheets' rows are excluded. */
  function selection(): SheetSelection {
    const accs: string[] = [];
    const rows: string[] = [];
    for (const account of accounts) {
      if (ticked.accounts.has(account.id)) accs.push(account.id);
      for (const li of linesOf(account)) if (ticked.rows.has(li.id)) rows.push(li.id);
    }
    return { accounts: accs, rows };
  }

  const marked = selection();

  function focusedRow(): { accountId: string; lineId?: string } | null {
    const el = document.activeElement as HTMLElement | null;
    const line = el?.closest<HTMLElement>("tr[data-line]");
    if (line?.dataset.account)
      return { accountId: line.dataset.account, lineId: line.dataset.line };
    const account = el?.closest<HTMLElement>("tr[data-account-row]");
    if (account?.dataset.accountRow) return { accountId: account.dataset.accountRow };
    return null;
  }

  /** Put the ticked things on the clipboard. Accounts win: an account brings its rows, so taking them twice would paste them twice. */
  function copySelection(): boolean {
    if (marked.accounts.length > 0) {
      const label = accounts.find((a) => a.id === marked.accounts[0])?.accountCode ?? "";
      onCopy({ kind: "accounts", ids: marked.accounts, label });
      notify.success(t("copiedAccounts", { count: marked.accounts.length }));
      // Clear the ticks so the "N markerade" bar does not linger over a copy already taken
      // (the paste bar says what is on the clipboard).
      clearTicks();
      return true;
    }
    if (marked.rows.length > 0) {
      onCopy({ kind: "rows", ids: marked.rows, label: String(marked.rows.length) });
      notify.success(t("copiedRows", { count: marked.rows.length }));
      clearTicks();
      return true;
    }
    return false;
  }

  /** ⌘C with nothing ticked copies the row being stood in; an account's own line takes the account, rows and all. */
  function copyHere(): boolean {
    if (copySelection()) return true;
    const at = focusedRow();
    if (!at) return false;
    if (!at.lineId) {
      const account = accounts.find((a) => a.id === at.accountId);
      if (!account) return false;
      onCopy({ kind: "accounts", ids: [account.id], label: account.accountCode });
      notify.success(t("copiedAccounts", { count: 1 }));
      return true;
    }
    onCopy({ kind: "rows", ids: [at.lineId], label: "1" });
    notify.success(t("copiedRows", { count: 1 }));
    return true;
  }

  /** True while a paste is in flight. A ref so it is true for the next keydown: a double ⌘V queued behind the paste route's row lock and pasted twice. */
  const pasting = useRef(false);

  function pasteHere(): boolean {
    if (!clip || !canPaste) return false;
    // Taken and dropped: returning false would hand the key to the browser mid-paste.
    if (pasting.current) return true;
    const at = focusedRow();
    if (clip.kind === "rows" && !at) {
      notify.info(t("pasteNeedsAccount"));
      return true;
    }
    pasting.current = true;
    void Promise.resolve(onPaste(clip, at?.accountId ?? null)).finally(() => {
      pasting.current = false;
    });
    return true;
  }

  /**
   * The sheet's own keys, on the document in the capture phase. The sheet div has no
   * tabIndex, so a handler on it never heard keys when focus was on body (⌘V did nothing).
   * Capture so they are decided before the cell layer's capture listener swallows one it
   * does not recognise. Nothing is taken while a cell is edited, from a text field outside
   * the sheet, or from an open dialog (the browser's own copy is meant).
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "v") return;
      if (isEditing()) return;

      const target = e.target as HTMLElement | null;
      // A dialog over the sheet is its own screen.
      if (target?.closest('[role="dialog"]')) return;
      // Text typed somewhere that is not one of the sheet's cells.
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (typing && !sheetRef.current?.contains(target)) return;

      const took = key === "c" ? copyHere() : pasteHere();
      // Nothing copied means nothing taken: the browser's own copy still works.
      if (!took) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // No dependency array on purpose: what a copy takes changes on almost every render, and a
    // stale list would copy rows ticked renders ago.
  });

  return {
    ticked,
    toggle,
    clearTicks,
    marked,
    copySelection,
    isTicked: (kind: "rows" | "accounts", id: string) => ticked[kind].has(id),
  };
}
