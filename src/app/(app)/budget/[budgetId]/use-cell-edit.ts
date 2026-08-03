// Spreadsheet select-vs-edit for a budget sheet, independent of what the sheet
// actually renders. A cell is "selected" when focused and stays read-only until
// Enter / F2 / double-click / typing puts it into edit mode.
//
// Movement is entirely the browser's own: Tab and Shift-Tab walk the natural
// focus order, arrow keys move the caret inside a cell. Nothing here intercepts
// them.
//
// Spread the returned props onto the element wrapping the sheet's table(s). Only
// the [data-cell] inputs — those rendered with `gated: true` — have the two
// modes; anything else (add-row inputs, comment boxes) is left alone.
import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { cn } from "@/lib/ui/utils";

export interface CellEditProps {
  className: string;
  onKeyDownCapture: (e: KeyboardEvent) => void;
  onFocusCapture: () => void;
  onDoubleClick: (e: MouseEvent) => void;
}

export function useCellEdit(className?: string): CellEditProps {
  // Edit mode is only ever read as a class: `.is-editing` restores the caret and
  // the selection highlight that a merely-selected cell suppresses.
  const [editing, setEditing] = useState(false);

  // Enter edit mode on an already-focused cell. The caret placement is what makes
  // the two modes legible: "end"/"here" leave a collapsed (blinking) insertion
  // point, so the cell reads as editing; "replace" selects everything so a typed
  // character overwrites the cell.
  function beginEdit(input: HTMLInputElement, caret: "end" | "here" | "replace") {
    setEditing(true);
    if (caret === "replace") { input.select(); return; }
    const at = caret === "here" ? (input.selectionEnd ?? input.value.length) : input.value.length;
    input.setSelectionRange(at, at);
  }

  function onKeyDownCapture(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (!t.dataset?.cell) return; // not a gated cell (e.g. an add-row input)
    const input = t as HTMLInputElement;

    if (editing) {
      // Leaving the cell drops back to selected; the input's own blur commits.
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); input.blur(); setEditing(false); }
      else if (e.key === "Tab" || e.key === "Escape") setEditing(false); // Tab moves natively; Escape reverts
      // Everything else — arrows, Home/End, text — belongs to the input.
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave shortcuts alone
    if (e.key === "Tab") return; // native focus order owns movement
    if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); e.stopPropagation(); beginEdit(input, "end"); }
    else if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete") beginEdit(input, "replace"); // type-to-edit: the key falls through and overwrites
    else { e.preventDefault(); e.stopPropagation(); } // ignore other keys while just selected
  }

  return {
    className: cn(className, editing && "is-editing"),
    onKeyDownCapture,
    // Moving to another cell (click or keyboard) leaves edit mode: focus selects.
    onFocusCapture: () => setEditing(false),
    onDoubleClick: (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // Collapse the browser's word-selection to where it was clicked, so a
      // double-click leaves a blinking caret at that spot rather than a highlight.
      if (t.dataset?.cell) beginEdit(t as HTMLInputElement, "here");
    },
  };
}
