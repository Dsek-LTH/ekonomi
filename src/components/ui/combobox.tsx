"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { useEscape } from "@/lib/ui/escape";
import { useDismissOnOutside } from "@/lib/ui/dismiss";
import { placeAnchored, useAnchorRect } from "@/lib/ui/anchored-panel";
import { usePhone } from "@/lib/ui/media";
import { CONTROL_CELL, CONTROL_SIZES, type ControlSize } from "./field";
import { CheckMark } from "./checkbox";
import { IconCheck, IconChevronDown } from "./icons";

export interface ComboOption {
  value: string;
  label: string;
  // Shown on the trigger when the field is too narrow; search still matches `label`.
  short?: string;
  // A hairline above this option, only on the full list (groups are gone once a search narrows it).
  dividerBefore?: boolean;
}

type SharedProps = {
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Offers the typed text as something to create when it is not in the list; what that means is the caller's. */
  onCreate?: (text: string) => void;
  createLabel?: (text: string) => string;
  clearLabel?: string;
  /** Whether the field can be typed into. Default: on from SEARCH_MIN options, or when `onCreate` needs text. */
  searchable?: boolean;
  disabled?: boolean;
  align?: "left" | "center";
  className?: string;
  /** Height from the shared control table. Filter bars and table toolbars pass "sm". */
  size?: ControlSize;
  /** "cell" turns into a borderless table cell inside a 2xl container (CONTROL_CELL in ui/field.tsx). */
  variant?: "field" | "cell";
  buttonClassName?: string; // replaces the default field appearance when given
  chevronClassName?: string; // for triggers on a coloured background
  invalid?: boolean;
  /** Opens its list on mount, for a picker a click has just put in place of something else. */
  openOnMount?: boolean;
  onClose?: () => void;
  // Takes focus on mount, for fields a click has just brought into existence.
  autoFocus?: boolean;
  "aria-label"?: string;
};

const SEARCH_MIN = 8;

// A strict, searchable single-select: only a value in `options` (or "" when `allowClear`) can be committed. The menu is portalled with fixed positioning so overflow ancestors do not clip it.
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

// The same field over a set of values: picking toggles and leaves the menu open. The empty set means "don't narrow", so clearing is always offered.
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
      onPick={(v) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])}
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
  searchable: searchableProp,
  createLabel,
  clearLabel,
  disabled,
  align = "left",
  size = "md",
  className,
  variant = "field",
  buttonClassName,
  chevronClassName,
  invalid,
  autoFocus,
  openOnMount = false,
  onClose,
  "aria-label": ariaLabel,
}: SharedProps & {
  values: string[];
  onPick: (value: string) => void;
  onClear?: () => void;
  multiple?: boolean;
}) {
  const t = useTranslations("common.combobox");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Ids so the search box can point at the highlighted option (options are not focused).
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const isPicked = (v: string) => values.includes(v);
  const picked = options.filter((o) => isPicked(o.value));
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : options;

  const offer =
    Boolean(onCreate) && q.length > 0 && !options.some((o) => o.label.trim().toLowerCase() === q);

  const triggerLabel =
    picked.length === 0
      ? null
      : picked.length === 1
        ? (picked[0].short ?? picked[0].label)
        : t("nSelected", { count: picked.length });

  // Where the field is on screen while open (lib/ui/anchored-panel.ts).
  const [rect, setRect] = useAnchorRect(open, triggerRef, panelRef, close);

  // On a phone the menu is a full screen: iOS slides the page under the keyboard without telling the layout, so a panel cannot be placed against it.
  const phone = usePhone();

  const searchable = searchableProp ?? (options.length >= SEARCH_MIN || Boolean(onCreate));
  /** Where typing happens: in the field itself on desktop, in the panel head elsewhere (phone, caller-drawn triggers, centred cells). */
  const inline = searchable && !phone && (align === "center" || !buttonClassName);

  function openMenu(initial = "") {
    if (disabled) return;
    setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setQuery(initial);
    setActive(
      initial
        ? 0
        : Math.max(
            0,
            options.findIndex((o) => isPicked(o.value)),
          ),
    );
    setOpen(true);
  }
  function close() {
    setOpen(false);
    onClose?.();
  }

  // Multi stays open and keeps the search; single has nothing left to offer.
  function commit(v: string) {
    onPick(v);
    if (!multiple) {
      close();
      triggerRef.current?.focus();
    }
  }

  // Escape closes only the menu: a dialog listening on the document must not close too (lib/ui/escape.ts).
  useEscape(open, () => {
    close();
    triggerRef.current?.focus();
  });

  /** Menu goes below unless it will not fit, estimating height from what it holds. The list shrinks and scrolls before flipping. */
  const CHROME = searchable && !inline ? 58 : 10;
  const ROW = 30;

  function menuStyle(): React.CSSProperties {
    if (!rect) return {};
    // Counted from the whole list, so the menu does not hop as somebody types.
    const listRows = options.length + (onClear ? 1 : 0) + (onCreate ? 1 : 0);
    const wanted = CHROME + Math.min(240, Math.max(1, listRows) * ROW);
    // No `cap`: this list knows how tall it wants to be.
    return placeAnchored(rect, { wanted, cap: true, width: Math.max(rect.width, 240) });
  }

  // Focus the search when opening, else the list (it must hold focus for the arrows and Enter). Close on outside click, scroll, resize.
  useEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
    else listRef.current?.focus();
  }, [open, searchable]);

  // The trigger, not the menu: opening on its own would drop a menu over the page.
  useEffect(() => {
    if (autoFocus) triggerRef.current?.focus();
  }, [autoFocus]);

  // A frame later, so the trigger has a rect. Mount only.
  useEffect(() => {
    if (!openOnMount) return;
    const frame = requestAnimationFrame(() => openMenu());
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  // Dismiss and placement live in lib/ui/dismiss.ts and lib/ui/anchored-panel.ts. The panel is portalled and the inline search lies over the trigger, so neither counts as "inside" the trigger.
  useDismissOnOutside(open, [triggerRef, searchRef, panelRef], close);

  const row = phone ? "py-3 text-base" : "py-1.5 text-sm";

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[active];
      if (o) commit(o.value);
    } else if (e.key === "Tab") {
      // Tab walks the options like the arrows (wrapping), moving the same highlight so no second focus ring appears.
      e.preventDefault();
      if (filtered.length === 0) return;
      const step = e.shiftKey ? -1 : 1;
      setActive((a) => (a + step + filtered.length) % filtered.length);
    }
  }

  return (
    // min-w-0: a truncate label floors the flex item at its whole string, so the field would not shrink below its placeholder.
    <div className={cn("relative min-w-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        // While the field is the search, this draws the focus ring for the input laid over it.
        data-search-open={(open && inline) || undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (open) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openMenu();
          } else if (
            (e.key === "Delete" || e.key === "Backspace") &&
            onClear &&
            values.length > 0
          ) {
            // Delete/Backspace clears a closed trigger, only where `onClear` is offered.
            e.preventDefault();
            onClear();
          } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            openMenu(e.key);
          }
        }}
        className={cn(
          "relative flex w-full items-center text-sm disabled:opacity-50",
          align === "center" ? "justify-center text-center" : "justify-between gap-1.5 text-left",
          buttonClassName ??
            (variant === "cell"
              ? cn(CONTROL_SIZES.sm, "border border-border-control bg-background", CONTROL_CELL)
              : cn(CONTROL_SIZES[size], "border border-border-control bg-background")),
          invalid && "text-danger",
        )}
      >
        <span
          className={cn(
            "truncate",
            align === "center" && "w-full",
            triggerLabel === null && "text-muted",
            open && inline && "invisible",
          )}
        >
          {triggerLabel ?? placeholder ?? t("placeholder")}
        </span>
        <IconChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform duration-200 ease-[var(--ease-out-quint)]",
            open && "rotate-180",
            align === "center" && "pointer-events-none absolute right-1",
            chevronClassName ?? "text-faint",
          )}
        />
      </button>

      {open && inline && (
        <input
          ref={searchRef}
          id={`${listId}-search`}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={filtered[active] ? optionId(active) : undefined}
          aria-autocomplete="list"
          data-combobox-search=""
          aria-label={ariaLabel ?? searchPlaceholder ?? t("searchPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onSearchKey}
          placeholder={
            multiple
              ? (searchPlaceholder ?? t("searchPlaceholder"))
              : (triggerLabel ?? searchPlaceholder ?? t("searchPlaceholder"))
          }
          autoComplete="off"
          className={cn(
            "absolute inset-y-0 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted",
            align === "center" ? "inset-x-5 text-center" : "left-0 right-8 px-2.5",
          )}
        />
      )}

      {open &&
        (phone || rect) &&
        createPortal(
          <div
            ref={panelRef}
            // Marks the menu as this field's (it is portalled to <body>, so containment cannot tell) and as its own focus layer (lib/ui/focus-trap.ts).
            data-combobox-panel=""
            data-popup-layer=""
            style={phone ? undefined : menuStyle()}
            // Above dialogs (z-[200]): the menu is portalled to <body> and a field inside a dialog would otherwise open behind it.
            className={cn(
              "z-[210] flex flex-col overflow-hidden bg-background",
              phone
                ? "fixed inset-0 pt-[env(safe-area-inset-top)]"
                : "rounded-panel border border-border shadow-[var(--shadow-pop)]",
            )}
          >
            {phone && (
              <div className="flex h-14 shrink-0 items-center gap-3 px-4">
                <p className="min-w-0 flex-1 truncate text-base font-semibold">
                  {ariaLabel ?? placeholder ?? t("placeholder")}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    triggerRef.current?.focus();
                  }}
                  className="-mr-2 rounded-control px-2 py-1.5 text-base font-medium text-accent"
                >
                  {multiple ? t("done") : t("cancel")}
                </button>
              </div>
            )}
            {searchable && !inline && (
              <div className={cn("shrink-0 border-b border-border", phone ? "px-4 pb-3" : "p-2")}>
                <input
                  ref={searchRef}
                  id={`${listId}-search`}
                  role="combobox"
                  aria-expanded
                  aria-controls={listId}
                  aria-activedescendant={filtered[active] ? optionId(active) : undefined}
                  aria-autocomplete="list"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onSearchKey}
                  placeholder={searchPlaceholder ?? t("searchPlaceholder")}
                  // 16px on a phone: iOS zooms in on smaller fields.
                  className={cn(
                    "w-full rounded-control border border-border-control bg-background",
                    phone ? "h-11 px-3 text-base" : "h-8 px-2.5 text-sm",
                  )}
                />
              </div>
            )}
            {/* tabIndex -1: a scroll container with no focusable children becomes a tab stop in Chrome. It also holds focus when there is no search box. */}
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-multiselectable={multiple || undefined}
              aria-activedescendant={!searchable && filtered[active] ? optionId(active) : undefined}
              tabIndex={-1}
              onKeyDown={searchable ? undefined : onSearchKey}
              className={cn(
                "min-h-0 flex-1 overflow-y-auto overscroll-contain",
                phone ? "px-2 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]" : "p-1",
              )}
            >
              {onClear && picked.length > 0 && (
                <li>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      onClear();
                      if (!multiple) {
                        close();
                        triggerRef.current?.focus();
                      }
                    }}
                    className={cn(
                      "flex w-full items-center rounded-control px-3 text-left text-muted hover:bg-hover",
                      row,
                    )}
                  >
                    {clearLabel ?? t("clear")}
                  </button>
                </li>
              )}
              {filtered.length === 0 && !offer && (
                <li className="px-3 py-2 text-sm text-muted">{emptyText ?? t("empty")}</li>
              )}
              {offer && (
                <li>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      close();
                      onCreate?.(query.trim());
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-control px-3 text-left font-medium text-accent hover:bg-hover",
                      row,
                    )}
                  >
                    {createLabel ? createLabel(query.trim()) : t("create", { text: query.trim() })}
                  </button>
                </li>
              )}
              {filtered.map((o, i) => (
                <Fragment key={o.value}>
                  {o.dividerBefore && !q && i > 0 && (
                    <li role="separator" aria-hidden className="mx-2 my-1 h-px bg-border" />
                  )}
                  <li>
                    <button
                      type="button"
                      id={optionId(i)}
                      data-index={i}
                      // Not a tab stop: focus stays in the search box and the arrows move the highlight.
                      tabIndex={-1}
                      role="option"
                      aria-selected={isPicked(o.value)}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => commit(o.value)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-control px-3 text-left transition-colors",
                        row,
                        // One indicator for the keyboard position: a neutral fill like a Menu row, not a ring.
                        i === active && "bg-hover",
                        isPicked(o.value) && "font-medium",
                      )}
                    >
                      {multiple && <CheckMark on={isPicked(o.value)} />}
                      <span className="mr-auto truncate">{o.label}</span>
                      {!multiple && isPicked(o.value) && (
                        <IconCheck className="size-4 shrink-0 text-accent" />
                      )}
                    </button>
                  </li>
                </Fragment>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
