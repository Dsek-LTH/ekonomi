"use client";

// The furniture around the stocktake sheet: what narrows it, and what saves it.
//
// Neither knows anything about a cell. The header is the night's date and the
// two controls that decide which rows and which column are on screen; the foot
// is the count of what is waiting and the two buttons that settle it. They sat
// at either end of the component that draws the grid between them, which is the
// one part of that file they have nothing to do with.
import { Button } from "@/components/ui/button";
import { CardHeader } from "@/components/ui/card";
import { DateInput } from "@/components/ui/field";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { SearchInput } from "@/components/ui/search-input";
import type { CellKind } from "@/lib/stock/cells";

type Translator = (key: string, values?: Record<string, string | number>) => string;

/**
 * The night's date, the search, and, on a phone, which column is showing.
 *
 * Narrowing the sheet matters more than it sounds: a night can run to thirty
 * products, and scrolling past twenty-nine of them to find the one on the
 * trolley is most of the work.
 *
 * Removing the night rides here too, which is not the same kind of control as
 * the rest and has nowhere better to be. The rule the app keeps is that what
 * you can do to a thing belongs to the card that describes it (see PageShell,
 * which has no action slot on purpose), and this sheet is the only card an
 * event has. So the button says it is removing the night rather than the sheet,
 * and sits apart from the date at the far end of the row.
 */
export function SheetHeader({
  t,
  canManage,
  occurredAt,
  onOccurredAt,
  search,
  onSearch,
  kinds,
  column,
  onColumn,
  onRemove,
}: {
  t: Translator;
  /** A reader who may not write gets the sheet without its controls. */
  canManage: boolean;
  occurredAt: string;
  onOccurredAt: (value: string) => void;
  search: string;
  onSearch: (value: string) => void;
  kinds: readonly CellKind[];
  column: CellKind;
  onColumn: (kind: CellKind) => void;
  /** Undo the whole night. Absent for a reader, like every other control. */
  onRemove?: () => void;
}) {
  return (
    <>
      <CardHeader
        title={t("event.sheet.title")}
        action={
          canManage ? (
            <div className="flex items-center gap-2">
              <div className="w-36">
                <DateInput
                  size="sm"
                  value={occurredAt}
                  onChange={(e) => onOccurredAt(e.target.value)}
                  aria-label={t("field.date")}
                />
              </div>
              {onRemove && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:bg-danger-soft"
                  onClick={onRemove}
                >
                  {t("event.remove")}
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="border-b border-border px-inset py-2">
        <div className="w-full sm:w-72">
          <SearchInput
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t("event.sheet.search")}
            aria-label={t("event.sheet.search")}
          />
        </div>
      </div>

      {/* The phone's whole answer to three columns: one at a time. Hidden where
          there is room for all three, since switching would then be a step that
          buys nothing. */}
      <div className="border-b border-border px-inset md:hidden">
        <FilterTabs
          options={kinds.map((kind) => ({ value: kind, label: t(`kind.${kind}`) }))}
          value={column}
          onChange={onColumn}
          // A third of the row each. These three are not a filter sitting in a
          // corner. They are the sheet's one control on a phone, and the column
          // being typed in should be as wide a target as the two that are not.
          fill
          aria-label={t("event.sheet.column")}
        />
      </div>
    </>
  );
}

/**
 * What is waiting to be written, and the two buttons that settle it.
 *
 * Nothing on the sheet is in the log until this is pressed, and the count is
 * the check that matters: a night is forty cells, and a figure typed into the
 * column beside the one you meant is invisible on the way past, but "38 rutor
 * väntar" when you expected 37 is not.
 *
 * Sticky, because a sheet with thirty products runs well past the bottom of a
 * phone, and a save button you have to hunt for is one that gets left unpressed.
 */
export function SheetSaveBar({
  t,
  changed,
  faults,
  pending,
  onSave,
  onDiscard,
}: {
  t: Translator;
  /** The cell keys holding something not yet written. */
  changed: string[];
  /** Those of them the server would refuse, each with why. */
  faults: ReadonlyMap<string, string>;
  pending: string | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const savable = changed.filter((k) => !faults.has(k)).length;
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-border bg-background px-inset py-3">
      <span className="text-sm text-muted">
        {changed.length === 0
          ? t("event.sheet.nothingToSave")
          : faults.size > 0
            ? t("event.sheet.unsavedWithFaults", { count: changed.length, faults: faults.size })
            : t("event.sheet.unsaved", { count: changed.length })}
      </span>
      <div className="flex items-center gap-2">
        {changed.length > 0 && (
          <Button variant="secondary" onClick={onDiscard} disabled={pending !== null}>
            {t("event.sheet.discard")}
          </Button>
        )}
        <Button
          onClick={onSave}
          // Every faulty cell is one the server would refuse anyway; the rows
          // already say which and why. Held back rather than blocking the save,
          // so one bad figure cannot strand the other thirty-nine.
          disabled={savable === 0}
          loading={pending === "save"}
        >
          {t("event.sheet.save")}
        </Button>
      </div>
    </div>
  );
}
