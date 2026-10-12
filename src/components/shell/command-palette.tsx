"use client";

// Cmd/Ctrl+K: jump straight to any page the reader may open, by typing its
// name rather than finding it in the sidebar.
//
// It exists beside the collapsible groups (app-shell.tsx) rather than instead
// of them. Collapsing shortens the list for someone scanning it, but a
// treasurer who touches five of the seven groups in a week is still looking
// for one of sixteen-odd rows most days, some of them behind a group they
// have to open first. Typing three letters is faster than either, and is the
// tool this app had none of before: everything under Inställningar, say, was
// unreachable from anywhere except the sidebar itself.
//
// Built on DialogLayer (components/ui/modal.tsx) for the scrim, Escape and
// the focus trap, the same chrome every other dialog in the app uses. Not a
// Combobox (components/ui/combobox.tsx): that is a field's own menu, anchored
// to a trigger and closed by picking one value for it. This has no field to
// anchor to (the shortcut can fire from anywhere) and nothing to hand a value
// back to; picking a row is following a link.
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconSearch } from "@/components/ui/icons";
import { Card } from "@/components/ui/card";
import { DialogLayer } from "@/components/ui/modal";
import { useProgressRouter } from "./route-progress";
import { cn } from "@/lib/ui/utils";

export interface CommandItem {
  href: string;
  /** Already resolved to the reader's language: this component has no nav
   *  table of its own to look keys up in, only what it's handed. */
  label: string;
  /** The group it sits under in the sidebar, shown as a hint beside it: two
   *  pages named alike ("Utlägg", "Uthyrningar") are told apart by more than
   *  their own word once several groups are in one flat, searchable list. */
  group: string;
  icon: (p: { className?: string }) => React.ReactNode;
}

/**
 * Opens the palette on Cmd+K (Mac) or Ctrl+K (everywhere else), from anywhere
 * in the app, including a page with no sidebar row for it in view (folded on
 * a phone, or simply scrolled past). Both modifiers are accepted regardless of
 * platform, which is the same thing every cross-platform web app with this
 * shortcut does, rather than sniffing the UA for one of them to refuse.
 */
export function useCommandPaletteHotkey(onOpen: () => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      // Otherwise this is also the browser's own "focus the address bar"
      // shortcut in some builds, and a page not free to say so would fight it.
      e.preventDefault();
      onOpen();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}

/**
 * Mounted only while open (`{paletteOpen && <CommandPalette .../>}` at the
 * call site), rather than always-mounted behind an `open` flag: a query typed
 * three pages ago is never what somebody reaching for the shortcut again
 * wants to see first, and a fresh mount starts every piece of state below
 * over for free instead of a "reset on open" effect resetting it by hand.
 */
export function CommandPalette({
  items,
  onClose,
}: {
  items: CommandItem[];
  onClose: () => void;
}) {
  const t = useTranslations("nav.palette");
  const router = useProgressRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Focus the field on arrival. A frame late: DialogLayer portals it in on
  // this same render, and focusing it before it exists in the DOM is a no-op.
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (i) => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q),
      )
    : items;

  // The options aren't focusable (the field holds focus throughout, same as
  // Combobox), so nothing scrolls the list on its own when the arrows move
  // past what is already in view.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(item: CommandItem) {
    onClose();
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[active];
      if (item) go(item);
    }
  }

  return (
    <DialogLayer
      onDismiss={onClose}
      // Near the top rather than centred: a command palette is found there in
      // every app that has one (Spotlight, Raycast, VS Code's own Cmd+K), and
      // a reader's eye is already there, on the shortcut they just pressed,
      // not in the middle of whatever page was open behind it.
      className="flex items-start justify-center p-4 pt-[12vh]"
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[min(28rem,70vh)] w-full max-w-lg flex-col overflow-hidden"
      >
        <div className="shrink-0 border-b border-border p-3">
          <div className="relative">
            <IconSearch
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={t("placeholder")}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              className="h-9 w-full rounded-control border border-border bg-background pl-8 pr-2.5 text-sm"
            />
          </div>
        </div>
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
        >
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted">{t("empty")}</li>
          )}
          {filtered.map((item, i) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <button
                  type="button"
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  // Mouse and keyboard share one highlight, the same rule
                  // Combobox follows: two indicators of "where this would go"
                  // would disagree the moment the pointer and the arrows had
                  // last touched different rows.
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(item)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-control px-3 py-2 text-left text-sm transition-colors",
                    // The same neutral highlight as a combobox option; see there.
                    i === active && "bg-hover",
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                  <span className="shrink-0 truncate text-xs text-muted">{item.group}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </DialogLayer>
  );
}
