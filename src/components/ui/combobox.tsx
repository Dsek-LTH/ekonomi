"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { useEscape } from "@/lib/ui/escape";
import { useDismissOnOutside } from "@/lib/ui/dismiss";
import { placeAnchored, useAnchorRect } from "@/lib/ui/anchored-panel";
import { CONTROL_SIZES, type ControlSize } from "./field";
import { CheckMark } from "./checkbox";
import { IconCheck, IconChevronDown } from "./icons";

export interface ComboOption {
  value: string;
  label: string;
  // Shown on the trigger instead of `label` when the field is too narrow for
  // the full text. Search still matches on `label`, so the long form stays
  // findable, and only the collapsed display is shortened.
  short?: string;
}

// Everything both variants take. `Combobox` and `MultiCombobox` differ only in
// the shape of their value, one string or a set of them, so they share the
// menu, the search, the keyboard handling and the positioning below.
type SharedProps = {
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /**
   * What to do about a value that is not in the list yet.
   *
   * The list is strict, so only something in `options` can be committed, which
   * is right for a cost centre and wrong for anything a person is allowed to
   * invent. Given this, the menu offers the text they typed as a thing to
   * create, and hands it back. What that means is the caller's business: a
   * product needs a drink type and a bottle size before it can exist, so the
   * stock sheet opens the product form with the name filled in rather than
   * conjuring a half-made row.
   */
  onCreate?: (text: string) => void;
  /** The offer, given what was typed. Defaults to a plain "Create …". */
  createLabel?: (text: string) => string;
  clearLabel?: string;
  /**
   * Whether the menu carries a box to filter by.
   *
   * On by default, because most of these stand over a list nobody can read at a
   * glance: a chart of accounts, every cost centre the section has. Off for a
   * short fixed set, where a search box is a field asking to be typed into in
   * order to choose between four numbers, which is more work than the menu it
   * is meant to shorten. Keyboard use survives either way; the list itself
   * takes the arrows and Enter when there is no box to hold them.
   */
  searchable?: boolean;
  disabled?: boolean;
  // How the selected value sits on the trigger. "center" is for grid/table
  // cells, where a left-aligned value reads as misaligned against its column.
  align?: "left" | "center";
  className?: string;
  /**
   * How tall it stands, from the same table every other control uses.
   *
   * "md" by default, because a combobox is a form control and the fields it
   * sits beside are md. It used to be hardcoded to the compact size, which is
   * why it never quite lined up with a date input. Filter bars and table
   * toolbars pass "sm".
   */
  size?: ControlSize;
  buttonClassName?: string; // replaces the default field appearance when given
  chevronClassName?: string; // for triggers on a coloured background
  invalid?: boolean;
  // Takes focus on mount. For fields a click has just brought into existence,
  // such as a new allocation row's cost centre, where the alternative is tabbing back
  // to the thing you asked for.
  autoFocus?: boolean;
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
// empty set means "don't narrow anything" rather than "nothing selected", which
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
  onCreate,
  searchable = true,
  createLabel,
  clearLabel,
  disabled,
  align = "left",
  size = "md",
  className,
  buttonClassName,
  chevronClassName,
  invalid,
  autoFocus,
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Ids so the search box can point at the option the arrow keys have landed on
  // The options aren't focused, so this is what announces them.
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const isPicked = (v: string) => values.includes(v);
  const picked = options.filter((o) => isPicked(o.value));
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : options;

  /** Whether to offer what was typed as something to make. Only when there is
   *  text and nothing in the list already is it. */
  const offer =
    Boolean(onCreate) &&
    q.length > 0 &&
    !options.some((o) => o.label.trim().toLowerCase() === q);

  // One picked value reads as itself; several can't, so the trigger counts them
  // instead. Nothing picked falls through to the placeholder.
  const triggerLabel =
    picked.length === 0 ? null
    : picked.length === 1 ? picked[0].short ?? picked[0].label
    : t("nSelected", { count: picked.length });

  // Where the field is on screen, kept current while the menu is open. See
  // lib/ui/anchored-panel.ts, shared with the menu, which explains why this
  // follows the trigger rather than closing when the page moves.
  const [rect, setRect] = useAnchorRect(open, triggerRef, panelRef, close);

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

  // Escape shuts the menu and hands the caret back to the trigger, and shuts
  // *only* the menu. It used to be handled on the search box, which worked, but
  // a dialog listening on the document heard the same key and closed itself
  // too. See lib/ui/escape.ts.
  useEscape(open, () => {
    close();
    triggerRef.current?.focus();
  });


  /**
   * Where the menu goes: below by default, above only when below will not do.
   *
   * It used to flip up whenever the viewport had less than 300 px under the
   * field, 300 being the menu's *tallest* it could ever be, with a full list
   * scrolled. A five-item menu is a third of that, so a field with plenty of
   * room under it kept opening upwards for no reason anybody watching could see.
   *
   * So the height is estimated from what the menu actually holds, and if even
   * that will not fit, the list shrinks and scrolls rather than the whole thing
   * jumping over the field. Flipping is the last resort it was meant to be:
   * only when there is genuinely more room the other way.
   */
  /** Search box and its border, plus the list's own padding. */
  const CHROME = 58;
  const ROW = 30;

  function menuStyle(): React.CSSProperties {
    if (!rect) return {};
    // Counted from the whole list rather than what is filtered right now, so
    // the menu does not hop about as somebody types.
    const listRows = options.length + (onClear ? 1 : 0) + (onCreate ? 1 : 0);
    const wanted = CHROME + Math.min(240, Math.max(1, listRows) * ROW);
    // `cap`, unlike the menu's: this list knows how tall it wants to be, so
    // growing past that would leave blank panel under the last option.
    return placeAnchored(rect, { wanted, cap: true, width: Math.max(rect.width, 240) });
  }

  // Focus the search when opening; close on outside click, scroll, resize.
  //
  // With no search box, the list takes the focus instead. Something inside the
  // panel has to hold it or the arrows and Enter would still be going to the
  // trigger, and closing would leave focus on an element that no longer exists.
  useEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
    else listRef.current?.focus();
  }, [open, searchable]);

  // The trigger, not the menu: the field is where you were sent, and the
  // trigger's type-to-open means the first character you type opens the search
  // with it anyway. Opening on its own would drop a menu over the page for
  // anyone who added a row to fill the amount in first.
  useEffect(() => {
    if (autoFocus) triggerRef.current?.focus();
  }, [autoFocus]);

  // The options aren't focusable, so nothing scrolls the list on its own.
  // Whichever key moved the highlight (arrows or Tab), bring it into view.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  // Outside taps close it; the page moving underneath re-places it (see the
  // anchor above). Both halves were written for a pointer and neither survived
  // an iPhone, which is why both now live in one place: lib/ui/dismiss.ts on
  // why the event is `pointerdown`, and lib/ui/anchored-panel.ts on why the
  // menu follows the field instead of closing when the keyboard scrolls it.
  //
  // The trigger and the panel are both the layer: the panel is portalled out of
  // the trigger's subtree, so a press on it is not a press "inside" the field.
  useDismissOnOutside(open, [triggerRef, panelRef], close);


  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = filtered[active]; if (o) commit(o.value); }
    else if (e.key === "Tab") {
      // Tab walks the options like the arrows do, wrapping at both ends, rather
      // than leaving the field. With the menu open the list is what you're
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
    // min-content width is the whole string, and a flex item defaults to
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
          buttonClassName ??
            cn(CONTROL_SIZES[size], "border border-border bg-background"),
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
        {/* Centred, the chevron leaves the flow entirely. As a flex sibling it
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
          // Marks the menu as this field's, for anything outside that has to
          // tell "focus left the field" from "focus went into its menu". The
          // menu is portalled to <body>, so containment can't answer that. The
          // voucher table's auto-balance reads it.
          data-combobox-panel=""
          // A layer of its own, over whatever it was opened from. A dialog
          // underneath holds Tab inside itself and has to leave this alone.
          // See lib/ui/focus-trap.ts.
          data-popup-layer=""
          style={menuStyle()}
          // Above everything, dialogs included. The menu is portalled to
          // <body>, so it shares a stacking context with the confirm dialog and
          // the modals (both z-[200]). At z-50 a field inside one of them
          // opened its options *behind* the dialog they belong to. It cannot
          // wrongly cover something else, because a menu only stays open while
          // its own trigger is on top: an outside mousedown closes it, which is
          // how anything above it would have been opened in the first place.
          className="z-[210] flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-[var(--shadow-pop)]"
        >
          {searchable && (
          <div className="shrink-0 border-b border-border p-2">
            <input
              ref={searchRef}
              // An id like every other field, so the browser does not report
              // one it cannot autofill. Nothing points at it: the listbox is
              // named by `aria-controls` below and the trigger carries the
              // field's own label.
              id={`${listId}-search`}
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
          )}
          {/* tabIndex -1: the list scrolls, and a scroll container with no
              focusable children of its own becomes a tab stop in Chrome.

              With no search box above it, this is also what holds the focus and
              therefore what the arrows, Enter and Escape arrive at. Same
              handler either way, so the two modes cannot drift into two
              different sets of keys. */}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-multiselectable={multiple || undefined}
            aria-activedescendant={
              !searchable && filtered[active] ? optionId(active) : undefined
            }
            tabIndex={-1}
            onKeyDown={searchable ? undefined : onSearchKey}
            className="min-h-0 flex-1 overflow-y-auto p-1"
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
            {filtered.length === 0 && !offer && (
              <li className="px-3 py-2 text-sm text-muted">{emptyText ?? t("empty")}</li>
            )}
            {/* Below the matches, not instead of them: somebody typing "norr"
                wants to see the two beers that start with it before being
                offered a third. */}
            {offer && (
              <li>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    close();
                    onCreate?.(query.trim());
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm font-medium text-accent hover:bg-surface"
                >
                  {createLabel ? createLabel(query.trim()) : t("create", { text: query.trim() })}
                </button>
              </li>
            )}
            {filtered.map((o, i) => (
              <li key={o.value}>
                <button
                  type="button"
                  id={optionId(i)}
                  data-index={i}
                  // Not a tab stop: focus stays in the search box and the arrow
                  // keys move the highlight. Left tabbable, every option was its
                  // own stop, and Tab put a focus ring on the first one, a
                  // second highlight competing with the arrow-key one.
                  tabIndex={-1}
                  role="option"
                  aria-selected={isPicked(o.value)}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(o.value)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
                    // One indicator for "where the keyboard is", carrying the
                    // focus ring. The options aren't focused themselves, so
                    // nothing else would draw one. Arrows, Tab and the mouse all
                    // move this same highlight; when the ring moved on its own
                    // it left a second, stale one behind at the top of the list.
                    i === active ? "bg-surface ring-1 ring-accent" : "hover:bg-surface",
                    isPicked(o.value) && "font-medium text-accent",
                  )}
                >
                  {/* Several options can be on at once, so each needs to show
                      its own on/off state whether or not it is the picked one,
                      a box that is either filled or empty. The single-select
                      below has only ever one, and marks it with a bare check.
                      The box is drawn by components/ui/checkbox, which is where
                      it went when the budget sheet wanted the same one. */}
                  {multiple && <CheckMark on={isPicked(o.value)} />}
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
