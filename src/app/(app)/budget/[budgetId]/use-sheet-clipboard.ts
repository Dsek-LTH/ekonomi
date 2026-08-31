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
import { useState } from "react";

import type { Account, BudgetClip, LineItem } from "./budget-types";

export interface SheetSelection {
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
  onPaste: (clip: BudgetClip, accountId: string | null) => void;
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
      return true;
    }
    if (marked.rows.length > 0) {
      onCopy({ kind: "rows", ids: marked.rows, label: String(marked.rows.length) });
      notify.success(t("copiedRows", { count: marked.rows.length }));
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

  function pasteHere(): boolean {
    if (!clip || !canPaste) return false;
    const at = focusedRow();
    if (clip.kind === "rows" && !at) {
      notify.info(t("pasteNeedsAccount"));
      return true;
    }
    onPaste(clip, at?.accountId ?? null);
    return true;
  }

  /**
   * The sheet's own keys, taken before the cell layer sees them, that one
   * swallows anything it doesn't recognise while a cell is merely selected.
   *
   * Nothing is taken while a cell is being edited: ⌘C there is copying text out
   * of a formula, and it has nothing to do with the rows.
   */
  const sheetKeys = (e: React.KeyboardEvent, isEditing: boolean): boolean => {
    if (isEditing) return false;
    if (!e.metaKey && !e.ctrlKey) return false;
    if (e.key === "c" || e.key === "C") {
      // Nothing copied means nothing taken: the browser's own copy still works
      // anywhere in the sheet that isn't a row.
      if (!copyHere()) return false;
      e.preventDefault();
      return true;
    }
    if (e.key === "v" || e.key === "V") {
      if (!pasteHere()) return false;
      e.preventDefault();
      return true;
    }
    return false;
  };

  return {
    ticked,
    toggle,
    clearTicks,
    marked,
    sheetKeys,
    /** Put the ticked things on the clipboard. The toolbar's button. */
    copySelection,
    /** Whether this id is ticked, for the box in the margin. */
    isTicked: (kind: "rows" | "accounts", id: string) => ticked[kind].has(id),
  };
}
