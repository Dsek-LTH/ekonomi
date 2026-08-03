"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { IconCheck, IconChevronDown } from "./icons";

export interface ComboOption {
  value: string;
  label: string;
  // Shown on the trigger instead of `label` when the field is too narrow for
  // the full text. Search still matches on `label`, so the long form stays
  // findable — only the collapsed display is shortened.
  short?: string;
}

// Everything both variants take. `Combobox` and `MultiCombobox` differ only in
// the shape of their value — one string or a set of them — so they share the
// menu, the search, the keyboard handling and the positioning below.
type SharedProps = {
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  clearLabel?: string;
  disabled?: boolean;
  // How the selected value sits on the trigger. "center" is for grid/table
  // cells, where a left-aligned value reads as misaligned against its column.
  align?: "left" | "center";
  className?: string;
  buttonClassName?: string; // replaces the default field appearance when given
  chevronClassName?: string; // for triggers on a coloured background
  invalid?: boolean;
  "aria-label"?: string;
};

// A strict, searchable single-select. You can filter by typing, but only a value
// that exists in `options` (or "" when `allowClear`) can be committed. The menu
// renders in a portal with fixed positioning so it never gets clipped by an
// overflow/scroll ancestor (e.g. a table). Styled to match the app's fields.
export function Combobox({
  value,
  onChange,
  allowClear = false,
  ...rest
}: SharedProps & {
  value: string;
  onChange: (value: string) => void;
  allowClear?: boolean;
}) {
  return (
    <ComboboxBase
      {...rest}
      values={value ? [value] : []}
      onPick={onChange}
      onClear={allowClear ? () => onChange("") : undefined}
    />
  );
}

// The same field over a set of values: picking toggles an option and leaves the
// menu open, so several can be chosen in one visit. Used for filters, where the
// empty set means "don't narrow anything" rather than "nothing selected" — which
// is why clearing is always offered and the trigger falls back to `placeholder`.
export function MultiCombobox({
  values,
  onChange,
  ...rest
}: SharedProps & {
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <ComboboxBase
      {...rest}
      multiple
      values={values}
      onPick={(v) =>
        onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])
      }
      onClear={() => onChange([])}
    />
  );
}

function ComboboxBase({
  options,
  values,
  onPick,
  onClear,
  multiple = false,
  placeholder,
  searchPlaceholder,
  emptyText,
  clearLabel,
  disabled,
  align = "left",
  className,
  buttonClassName,
  chevronClassName,
  invalid,
  "aria-label": ariaLabel,
}: SharedProps & {
  values: string[];
  onPick: (value: string) => void;
  // Offers the "clear" row above the options once something is picked.
  onClear?: () => void;
  multiple?: boolean;
}) {
  // Every label here has a sensible generic default, so most call sites pass
  // none and only the ones that can say something more specific ("Pick a cost
  // centre…") override it.
  const t = useTranslations("common.combobox");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Ids so the search box can point at the option the arrow keys have landed on
  // — the options aren't focused, so this is what announces them.
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const isPicked = (v: string) => values.includes(v);
  const picked = options.filter((o) => isPicked(o.value));
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : options;

  // One picked value reads as itself; several can't, so the trigger counts them
  // instead. Nothing picked falls through to the placeholder.
  const triggerLabel =
    picked.length === 0 ? null
    : picked.length === 1 ? picked[0].short ?? picked[0].label
    : t("nSelected", { count: picked.length });

  function openMenu(initial = "") {
    if (disabled) return;
    setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setQuery(initial);
    setActive(initial ? 0 : Math.max(0, options.findIndex((o) => isPicked(o.value))));
    setOpen(true);
  }
  function close() { setOpen(false); }
  // Picking one of several is rarely the last thing you want to do, so multi
  // stays open and keeps the search you typed; single has nothing left to offer.
  function commit(v: string) {
    onPick(v);
    if (!multiple) { close(); triggerRef.current?.focus(); }
  }


  // Fixed-position menu, flipped up / clamped so it never spills off-screen.
  function menuStyle(): React.CSSProperties {
    if (!rect) return {};
    const width = Math.max(rect.width, 240);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const below = window.innerHeight - rect.bottom;
    const dropUp = below < 300 && rect.top > below;
    return dropUp
      ? { position: "fixed", bottom: window.innerHeight - rect.top + 4, left, width }
      : { position: "fixed", top: rect.bottom + 4, left, width };
  }

  // Focus the search when opening; close on outside click, scroll, resize.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // The options aren't focusable, so nothing scrolls the list on its own —
  // whichever key moved the highlight (arrows or Tab), bring it into view.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    // Close when an ancestor/page scrolls (the fixed menu would be misplaced),
    // but NOT when scrolling inside the menu's own option list.
    const onScroll = (e: Event) => { if (!panelRef.current?.contains(e.target as Node)) close(); };
    const onResize = () => close();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = filtered[active]; if (o) commit(o.value); }
    else if (e.key === "Escape") { e.preventDefault(); close(); triggerRef.current?.focus(); }
    else if (e.key === "Tab") {
      // Tab walks the options like the arrows do, wrapping at both ends, rather
      // than leaving the field — with the menu open the list is what you're
      // moving through. Enter picks the highlighted one; Escape gets you out.
      //
      // It moves the same highlight the arrows use. When the options were tab
      // stops of their own, Tab drew the browser's focus ring on one of them
      // instead, which read as a second, competing highlight.
      e.preventDefault();
      if (filtered.length === 0) return;
      const step = e.shiftKey ? -1 : 1;
      setActive((a) => (a + step + filtered.length) % filtered.length);
    }
  }

  return (
    // min-w-0: the trigger's label is `truncate`, i.e. nowrap, so its
    // min-content width is the whole string — and a flex item defaults to
    // min-width:auto, which floors at exactly that. Without this the field
    // can't shrink below its own placeholder ("Välj kostnadsställe…") and
    // pushes whatever row it sits in past the edge instead of ellipsising.
    <div className={cn("relative min-w-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (open) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openMenu();
          } else if ((e.key === "Delete" || e.key === "Backspace") && onClear && values.length > 0) {
            // Emptying a field with Delete/Backspace is what the keyboard
            // expects, so the closed trigger takes it as the "Clear" row does.
            // Gated on `onClear`: where clearing isn't offered, "" is not a
            // state the caller has a meaning for.
            e.preventDefault();
            onClear();
          } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            // Type-to-open: start the search with the first character.
            e.preventDefault();
            openMenu(e.key);
          }
        }}
        className={cn(
          "relative flex w-full items-center text-sm disabled:opacity-50",
          align === "center" ? "justify-center text-center" : "justify-between gap-1.5 text-left",
          buttonClassName ?? "h-9 rounded-lg border border-border bg-background px-2.5",
          invalid && "text-danger",
        )}
      >
        <span
          className={cn(
            "truncate",
            align === "center" && "w-full",
            triggerLabel === null && "text-muted/60",
          )}
        >
          {triggerLabel ?? placeholder ?? t("placeholder")}
        </span>
        {/* Centred, the chevron leaves the flow entirely — as a flex sibling it
            would shift the label left by half its width and the value would sit
            off-centre in the box. */}
        <IconChevronDown
          className={cn(
            "size-4 shrink-0",
            align === "center" && "pointer-events-none absolute right-1",
            chevronClassName ?? "text-muted/60",
          )}
        />
      </button>

      {open && rect && createPortal(
        <div
          ref={panelRef}
          style={menuStyle()}
          className="z-50 overflow-hidden rounded-xl border border-border bg-background shadow-[var(--shadow-pop)]"
        >
          <div className="border-b border-border p-2">
            <input
              ref={searchRef}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={filtered[active] ? optionId(active) : undefined}
              aria-autocomplete="list"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onSearchKey}
              placeholder={searchPlaceholder ?? t("searchPlaceholder")}
              className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm"
            />
          </div>
          {/* tabIndex -1: the list scrolls, and a scroll container with no
              focusable children of its own becomes a tab stop in Chrome. */}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-multiselectable={multiple || undefined}
            tabIndex={-1}
            className="max-h-60 overflow-y-auto p-1"
          >
            {onClear && picked.length > 0 && (
              <li>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    onClear();
                    if (!multiple) { close(); triggerRef.current?.focus(); }
                  }}
                  className="flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm text-muted hover:bg-surface"
                >
                  {clearLabel ?? t("clear")}
                </button>
              </li>
            )}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted">{emptyText ?? t("empty")}</li>
            )}
            {filtered.map((o, i) => (
              <li key={o.value}>
                <button
                  type="button"
                  id={optionId(i)}
                  data-index={i}
                  // Not a tab stop: focus stays in the search box and the arrow
                  // keys move the highlight. Left tabbable, every option was its
                  // own stop, and Tab put a focus ring on the first one — a
                  // second highlight competing with the arrow-key one.
                  tabIndex={-1}
                  role="option"
                  aria-selected={isPicked(o.value)}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(o.value)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
                    // One indicator for "where the keyboard is", carrying the
                    // focus ring — the options aren't focused themselves, so
                    // nothing else would draw one. Arrows, Tab and the mouse all
                    // move this same highlight; when the ring moved on its own
                    // it left a second, stale one behind at the top of the list.
                    i === active ? "bg-surface ring-1 ring-accent" : "hover:bg-surface",
                    isPicked(o.value) && "font-medium text-accent",
                  )}
                >
                  {/* Several options can be on at once, so each needs to show
                      its own on/off state whether or not it is the picked one —
                      a box that is either filled or empty. The single-select
                      below has only ever one, and marks it with a bare check.
                      The fill is `accent-soft`, not `accent`: the dark theme's
                      accent is a pale pink that no foreground sits on legibly. */}
                  {multiple && (
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        isPicked(o.value) ? "border-accent bg-accent-soft" : "border-border",
                      )}
                    >
                      {isPicked(o.value) && <IconCheck className="size-3" />}
                    </span>
                  )}
                  <span className="mr-auto truncate">{o.label}</span>
                  {!multiple && isPicked(o.value) && <IconCheck className="size-4 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
