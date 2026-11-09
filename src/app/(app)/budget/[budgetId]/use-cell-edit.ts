// Spreadsheet select-vs-edit for a budget sheet. A [data-cell] input (`gated: true`) is
// selected on focus and read-only until Enter, F2, double-click or typing. Movement is the
// browser's own (Tab, arrows). Spread the returned props onto the element wrapping the tables.
import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { cn } from "@/lib/ui/utils";

interface CellEditProps {
  className: string;
  onKeyDownCapture: (e: KeyboardEvent) => void;
  onFocusCapture: () => void;
  onDoubleClick: (e: MouseEvent) => void;
}

export function useCellEdit(className?: string): CellEditProps {
  const [editing, setEditing] = useState(false);

  // "end"/"here" leave a collapsed caret (reads as editing); "replace" selects all so typing overwrites.
  function beginEdit(input: HTMLInputElement, caret: "end" | "here" | "replace") {
    setEditing(true);
    if (caret === "replace") {
      input.select();
      return;
    }
    const at = caret === "here" ? (input.selectionEnd ?? input.value.length) : input.value.length;
    input.setSelectionRange(at, at);
  }

  function onKeyDownCapture(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (!t.dataset.cell) return; // not a gated cell (e.g. an add-row input)
    const input = t as HTMLInputElement;

    if (editing) {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        input.blur();
        setEditing(false);
      } else if (e.key === "Tab" || e.key === "Escape") setEditing(false); // Tab moves natively; Escape reverts
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave shortcuts alone
    if (e.key === "Tab") return; // native focus order owns movement
    if (e.key === "Enter" || e.key === "F2") {
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
