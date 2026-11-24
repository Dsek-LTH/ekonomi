// Spreadsheet select-vs-edit for a budget sheet. A [data-cell] input (`gated: true`) is
// selected on focus and read-only until Enter, F2, double-click or typing. Movement is Excel's:
// the arrows move a selected cell, and also an edit begun by typing (which saves it, since
// leaving a cell commits it); an edit begun by Enter, F2 or double-click keeps the arrows for
// the caret. Enter ends an edit and moves down, Shift+Enter up. Tab is the browser's own.
// Spread the returned props onto the element wrapping the tables.
import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { cn } from "@/lib/ui/utils";

interface CellEditProps {
  className: string;
  onKeyDownCapture: (e: KeyboardEvent) => void;
  onFocusCapture: () => void;
  onDoubleClick: (e: MouseEvent) => void;
}

type Direction = "up" | "down" | "left" | "right";

const ARROWS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/**
 * The cell next to `from` in `dir`, or null at the edge. Measured on screen, not counted in
 * rows: account rows, add rows and section headings hold no [data-cell] and are stepped over,
 * and a column is wherever the cell's middle falls.
 */
export function neighbourCell(
  container: HTMLElement,
  from: HTMLInputElement,
  dir: Direction,
): HTMLInputElement | null {
  // An account's blank row (sheet-account.tsx) is a stop too, so a column can be walked into it.
  const cells = Array.from(
    container.querySelectorAll<HTMLInputElement>("input[data-cell], input[data-blank-cell]"),
  );
  const box = (el: HTMLElement) => (el.closest("td") ?? el).getBoundingClientRect();
  const here = box(from);

  if (dir === "left" || dir === "right") {
    const row = from.closest("tr");
    const inRow = cells.filter((c) => c.closest("tr") === row);
    const i = inRow.indexOf(from);
    return inRow[dir === "left" ? i - 1 : i + 1] ?? null;
  }

  const middle = here.left + here.width / 2;
  let best: HTMLInputElement | null = null;
  let bestTop = dir === "down" ? Infinity : -Infinity;
  for (const c of cells) {
    if (c === from) continue;
    const b = box(c);
    if (middle < b.left || middle > b.right) continue;
    if (
      dir === "down"
        ? b.top >= here.bottom - 1 && b.top < bestTop
        : b.bottom <= here.top + 1 && b.top > bestTop
    ) {
      best = c;
      bestTop = b.top;
    }
  }
  return best;
}

export function useCellEdit(className?: string): CellEditProps {
  const [editing, setEditing] = useState(false);
  // How the edit began: typing over the cell lets the arrows leave it, as in Excel.
  const typedOver = useRef(false);

  // "end"/"here" leave a collapsed caret (reads as editing); "replace" selects all so typing overwrites.
  function beginEdit(input: HTMLInputElement, caret: "end" | "here" | "replace") {
    setEditing(true);
    typedOver.current = caret === "replace";
    if (caret === "replace") {
      input.select();
      return;
    }
    const at = caret === "here" ? (input.selectionEnd ?? input.value.length) : input.value.length;
    input.setSelectionRange(at, at);
  }

  /** Focus the neighbour in `dir`. Leaving a cell commits it (its blur), and focus selects. */
  function move(container: HTMLElement, input: HTMLInputElement, dir: Direction): boolean {
    const next = neighbourCell(container, input, dir);
    if (!next) return false;
    next.focus();
    return true;
  }

  function onKeyDownCapture(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    const input = t as HTMLInputElement;
    const container = e.currentTarget as HTMLElement;
    const dir = ARROWS[e.key];

    // A blank row is always being typed in: left and right stay with the caret, up and down
    // leave it (which saves it, see sheet-account.tsx).
    if (t.dataset.blankCell !== undefined) {
      if ((dir === "up" || dir === "down") && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        move(container, input, dir);
      }
      return;
    }
    if (!t.dataset.cell) return; // not a sheet cell (the comment box, say)

    if (editing) {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        // At the last row there is nowhere to go, so the edit just ends.
        if (!move(container, input, e.shiftKey ? "up" : "down")) input.blur();
        setEditing(false);
      } else if (dir && typedOver.current && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (move(container, input, dir)) setEditing(false);
      } else if (e.key === "Tab" || e.key === "Escape") setEditing(false); // Tab moves natively; Escape reverts
      return;
    }

    // ⌘V on a selected cell is the cell's own (onPaste in use-budget-cells.tsx).
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave shortcuts alone
    if (e.key === "Tab") return; // native focus order owns movement
    if (dir) {
      e.preventDefault();
      e.stopPropagation();
      move(container, input, dir);
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      e.stopPropagation();
      beginEdit(input, "end");
    } else if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete")
      beginEdit(input, "replace"); // type-to-edit: the key falls through and overwrites
    else {
      e.preventDefault();
      e.stopPropagation();
    } // ignore other keys while just selected
  }

  return {
    className: cn(className, editing && "is-editing"),
    onKeyDownCapture,
    // Moving to another cell (click or keyboard) leaves edit mode: focus selects.
    onFocusCapture: () => setEditing(false),
    onDoubleClick: (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // Collapse the word-selection so a double-click leaves a caret.
      if (t.dataset.cell) beginEdit(t as HTMLInputElement, "here");
    },
  };
}
