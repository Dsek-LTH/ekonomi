"use client";

// ⌘C, ⌘X and ⌘V on a budget sheet, and the clipboard the page holds between sheets. What they
// act on is the selection (use-range-select.ts): rows picked by their numbers, or a block of
// cells. Rows go to the server by id: the paste route also re-points equations inside a copied
// block at the copies.
import { useEffect, useRef } from "react";

import type { BudgetClip } from "./budget-types";

export function useSheetClipboard({
  clip,
  onCopy,
  canPaste,
  onPaste,
  sheetRef,
  isEditing,
  copyRange,
  cutRows,
  copyCell,
  notify,
  t,
}: {
  clip: BudgetClip | null;
  onCopy: (clip: BudgetClip | null) => void;
  canPaste: boolean;
  /** Send the paste, given the clipboard and the account the caret is in (null if none: rows must land in an account). */
  onPaste: (
    clip: BudgetClip,
    accountId: string | null,
    /** The line the caret is on, if any: copied rows are written over it and those below. */
    lineId: string | null,
  ) => void | Promise<unknown>;
  /** The sheet's element, to tell whether a focused text field is one of its cells. */
  sheetRef: React.RefObject<HTMLElement | null>;
  /** Whether a cell is being edited now. Read when a key arrives, since the listener outlives a render. */
  isEditing: () => boolean;
  /** Copy the block of cells selected (use-range-select.ts). False when there is none. */
  copyRange?: () => boolean;
  /** ⌘X: cut the rows or cells selected. False when there are none. */
  cutRows?: () => boolean;
  /** Copy the one selected cell (its input) as the sheet copies a block. False to copy its text. */
  copyCell?: (input: HTMLInputElement) => boolean;
  notify: { success: (m: string) => void; info: (m: string) => void };
  t: (key: string, values?: Record<string, number>) => string;
}) {
  function focusedRow(): { accountId: string; lineId?: string } | null {
    const el = document.activeElement as HTMLElement | null;
    const line = el?.closest<HTMLElement>("tr[data-line]");
    if (line?.dataset.account)
      return { accountId: line.dataset.account, lineId: line.dataset.line };
    const account = el?.closest<HTMLElement>("tr[data-account-row]");
    if (account?.dataset.accountRow) return { accountId: account.dataset.accountRow };
    return null;
  }

  /**
   * ⌘C: the rows or block selected, else the selected cell's value (what it shows: a Belopp
   * cell being stood in shows its formula). A selected cell has no visible text selection, so
   * the browser's own copy would take nothing. Copying a cell lets go of copied rows, so the
   * next ⌘V pastes the text (use-cell-edit.ts) and not the rows.
   */
  function copyHere(): boolean {
    // The selection says itself what it leaves on the page's clipboard (rows, or nothing).
    if (copyRange?.()) return true;
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement) || el.dataset.cell === undefined) return false;
    if (!sheetRef.current?.contains(el)) return false;
    if (copyCell?.(el)) return true;
    void navigator.clipboard.writeText(el.value).catch(() => {});
    if (clip) onCopy(null);
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
    void Promise.resolve(onPaste(clip, at?.accountId ?? null, at?.lineId ?? null)).finally(() => {
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
      if (key !== "c" && key !== "v" && key !== "x") return;
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
      // The formula bar is in the sheet but is text, like a cell being edited.
      if (target?.dataset.formulaBar) return;

      const took = key === "c" ? copyHere() : key === "x" ? (cutRows?.() ?? false) : pasteHere();
      // Nothing copied means nothing taken: the browser's own copy still works.
      if (!took) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // No dependency array on purpose: what a copy takes changes on almost every render, and a
    // stale list would copy rows selected renders ago.
  });
}
