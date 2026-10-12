"use client";

// Ticking rows on a budget sheet, and copying them somewhere else.
//
// One concern with three faces (the ticks in the margin, ⌘C/⌘V, and the
// clipboard the page holds between sheets) and it was a hundred and forty
// lines in the middle of the component that draws the sheet itself. Nothing
// else in that component reads any of it, which is the definition of a seam.
//
// The rows are named to the server by id, not by content: the paste route is
// also what re-points equations inside a copied block at the copies, so nothing
// about a row is described twice.
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
  /** This sheet's accounts, in the order it draws them. */
  accounts: Account[];
  /** A account's rows as the sheet currently shows them. A drag may reorder. */
  linesOf: (account: Account) => LineItem[];
  clip: BudgetClip | null;
  onCopy: (clip: BudgetClip | null) => void;
  /** Whether this reader may write to the budget at all. */
  canPaste: boolean;
  /**
   * Send the paste. Given the clipboard and the account the caret is in, or
   * null when it is in none, rows have to land in an account, and which one is
   * not for a clipboard to guess.
   */
  onPaste: (clip: BudgetClip, accountId: string | null) => void | Promise<unknown>;
  /** The sheet's own element. Keys are taken on the document, so this is what
   *  says whether a focused text field is one of the sheet's cells. */
  sheetRef: React.RefObject<HTMLElement | null>;
  /** Whether a cell is being edited right now. Read at the moment a key
   *  arrives rather than passed in, since the listener outlives a render. */
  isEditing: () => boolean;
  notify: { success: (m: string) => void; info: (m: string) => void };
  t: (key: string, values?: Record<string, number>) => string;
}) {
  /**
   * What is ticked. Kept across sheets deliberately. Copying a block from one
   * cost centre onto another is the entire point, and this component goes with
   * the sheet.
   */
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

  /**
   * What is ticked *on this sheet*, in the order the sheet draws it.
   *
   * This sheet's, because the ticks outlive it: the component stays mounted as
   * the cost centre beside it changes, and a row ticked two sheets ago is not
   * something a copy here should quietly take. Drawing order, because that is
   * the order the rows will be pasted in.
   */
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

  /** Which row and account the focus is in, read off the row's own markers. */
  function focusedRow(): { accountId: string; lineId?: string } | null {
    const el = document.activeElement as HTMLElement | null;
    const line = el?.closest<HTMLElement>("tr[data-line]");
    if (line?.dataset.account) return { accountId: line.dataset.account, lineId: line.dataset.line };
    const account = el?.closest<HTMLElement>("tr[data-account-row]");
    if (account?.dataset.accountRow) return { accountId: account.dataset.accountRow };
    return null;
  }

  /**
   * Put the ticked things on the clipboard. Accounts win where both are ticked:
   * an account brings its rows with it, so the rows inside one are already in
   * the copy and taking them twice would paste them twice.
   */
  function copySelection(): boolean {
    if (marked.accounts.length > 0) {
      const label = accounts.find((a) => a.id === marked.accounts[0])?.accountCode ?? "";
      onCopy({ kind: "accounts", ids: marked.accounts, label });
      notify.success(t("copiedAccounts", { count: marked.accounts.length }));
      // The ticks have done their job. Left standing, the "N markerade" bar
      // stays up over a copy that has already been taken, so nothing on screen
      // distinguishes "about to copy these" from "copied these a minute ago",
      // and the next ⌘C silently takes the same rows again. What is on the
      // clipboard is said by the paste bar instead, which is where it belongs.
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

  /**
   * ⌘C with nothing ticked: the one row being stood in, which is what it looks
   * like it should do. An account's own line takes the account, rows and all.
   */
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

  /**
   * True while a paste is in flight.
   *
   * A ref, not state: nothing on screen turns on it, and it has to be true for
   * the very next keydown rather than after a render. Holding ⌘V, or pressing
   * it twice while the first request is still out, sent two of them. Both
   * succeeded (the second simply queued behind the first's row lock in the
   * paste route) and the rows landed twice.
   */
  const pasting = useRef(false);

  function pasteHere(): boolean {
    if (!clip || !canPaste) return false;
    // Taken, and deliberately dropped. Returning false would hand the key back
    // to the browser mid-paste, which is not what a repeat press means.
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
   * The sheet's own keys.
   *
   * On the document, in the capture phase, rather than on the sheet's own
   * element. The sheet is a plain `div` with no `tabIndex`, so it can never
   * hold focus itself: a handler on it only ever heard keys from a focused
   * descendant, meaning a cell input or a tick box. Click a heading, the Summa
   * row, the gap between two cells, or dismiss a toast, and focus was on
   * `<body>`, where ⌘V did nothing whatsoever. No message, no toast, nothing to
   * tell you why. That is most of what made this feel unreliable.
   *
   * Capture, because the cell layer's own handler is a capture listener on the
   * sheet: the document sees a key first there, and the sheet's keys are meant
   * to be decided before a cell gets the chance to swallow one it does not
   * recognise. What is taken is stopped outright, so the cell layer never sees
   * it at all.
   *
   * Nothing is taken while a cell is being edited: ⌘C there is copying text out
   * of a formula and has nothing to do with the rows. Nor from a text field
   * outside the sheet or from an open dialog, where the browser's own copy is
   * what was meant.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "v") return;
      if (isEditing()) return;

      const target = e.target as HTMLElement | null;
      // A dialog over the sheet is its own screen. The sheet is still mounted
      // behind it, and copying its rows from inside one is nobody's intent.
      if (target?.closest('[role="dialog"]')) return;
      // Somewhere text is being typed that is not one of the sheet's cells: a
      // search box, a filter, a field in a panel beside it.
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (typing && !sheetRef.current?.contains(target)) return;

      const took = key === "c" ? copyHere() : pasteHere();
      // Nothing copied means nothing taken: the browser's own copy still works
      // where the sheet has nothing to offer.
      if (!took) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // No dependency array, deliberately. What a copy takes depends on what is
    // ticked and what is on the clipboard, and both change on almost every
    // render of this sheet; listing them would be listing everything, and
    // getting the list wrong would mean ⌘C quietly copying what was ticked
    // some renders ago. Re-binding one document listener per render is nothing
    // beside a keystroke that takes the wrong rows.
  });

  return {
    ticked,
    toggle,
    clearTicks,
    marked,
    /** Put the ticked things on the clipboard. The toolbar's button. */
    copySelection,
    /** Whether this id is ticked, for the box in the margin. */
    isTicked: (kind: "rows" | "accounts", id: string) => ticked[kind].has(id),
  };
}
