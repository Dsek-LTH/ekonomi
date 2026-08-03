"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconPencil } from "@/components/ui/icons";
import { cn } from "@/lib/ui/utils";

// A value that reads as plain text until you click its pencil, then becomes an
// input in its place. Enter commits, Escape abandons the edit, and clicking away
// commits too — leaving a field is how every other cell in this app is finished,
// and silently discarding what someone typed is the worse surprise.
//
// The text itself inherits the surrounding type, so the same component is a page
// title in one place and a table cell in another; only the input needs a width.
export function EditableText({
  value,
  onSave,
  label,
  type = "text",
  placeholder,
  disabled,
  className,
  inputClassName,
}: {
  value: string;
  /**
   * Commit. Return `false` to reject the value and stay in the edit — the
   * caller owns validation, since only it knows what a valid year or name is.
   */
  onSave: (value: string) => boolean | void | Promise<boolean | void>;
  /** Names the pencil ("Byt år") and the input, so both are reachable by voice
   *  and screen reader. */
  label: string;
  type?: "text" | "number";
  placeholder?: string;
  /** Read-only: the text without a pencil. */
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  // Escape closes the input, which blurs it — without this the blur would
  // commit the very edit that was just abandoned.
  const abandoned = useRef(false);

  function start() {
    setDraft(value);
    abandoned.current = false;
    setEditing(true);
  }

  async function commit() {
    if (abandoned.current || saving) return;
    if (draft === value) { setEditing(false); return; } // nothing to write
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok !== false) setEditing(false);
  }

  if (editing) {
    return (
      <Input
        value={draft}
        type={type}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { abandoned.current = true; setEditing(false); }
        }}
        placeholder={placeholder}
        aria-label={label}
        autoFocus
        className={cn(type === "number" && "tabular-nums", inputClassName)}
      />
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {value || <span className="text-muted">{placeholder}</span>}
      {!disabled && (
        <IconButton label={label} onClick={start}>
          <IconPencil className="size-4" />
        </IconButton>
      )}
    </span>
  );
}
