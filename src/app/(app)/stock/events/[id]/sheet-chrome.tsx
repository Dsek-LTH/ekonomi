"use client";

// The furniture around the stocktake sheet: what narrows it, and what saves it.
//
// Neither knows anything about a cell. The header is the controls that decide
// which rows and which column are on screen; the foot
// is the count of what is waiting and the two buttons that settle it. They sat
// at either end of the component that draws the grid between them, which is the
// one part of that file they have nothing to do with.
import { Button } from "@/components/ui/button";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { IconScan } from "@/components/ui/icons";
import { SearchInput } from "@/components/ui/search-input";
import type { CellKind } from "@/lib/stock/cells";

type Translator = (key: string, values?: Record<string, string | number>) => string;

/**
 * The sheet's one toolbar: the search, the scanner and, on a phone, which
 * column is showing.
 *
 * No date input. The night's date is the page's subtitle, and it is changed in
 * the dialog behind "Ändra tillfället", which moves the rows booked on it too. A
 * date field here looked like that, and only restamped what the sheet wrote.
 *
 * Narrowing the sheet matters more than it sounds: a night can run to thirty
 * products, and scrolling past twenty-nine of them to find the one on the
 * trolley is most of the work. The scanner sits beside the search because it
 * is the same errand done with a barcode: a code already on the sheet jumps to
 * its row, and one that is not puts it there.
 *
 * It used to be three bars: a card title with the event's own buttons, the
 * search alone on a row, then the column switch. The title said what the band
 * above already says, and editing or removing the night is something done to
 * the page rather than to the sheet, so those went to the page's header.
 */
export function SheetHeader({
  t,
  search,
  onSearch,
  onScan,
  kinds,
  column,
  onColumn,
}: {
  t: Translator;
  search: string;
  onSearch: (value: string) => void;
  /** Scan a barcode onto the sheet. Absent for a reader. */
  onScan?: () => void;
  kinds: readonly CellKind[];
  column: CellKind;
  onColumn: (kind: CellKind) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-inset py-2">
        <div className="min-w-0 flex-1 sm:max-w-72">
          <SearchInput
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t("event.sheet.search")}
            aria-label={t("event.sheet.search")}
          />
        </div>
        {onScan && (
          <Button variant="secondary" onClick={onScan} title={t("event.sheet.scan")}>
            <IconScan className="size-4" />
            <span className="hidden sm:inline">{t("event.sheet.scanShort")}</span>
          </Button>
        )}
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
 * The foot of the sheet, where it scrolls with the rows. It was pinned to the
 * bottom of the screen, which on a phone put it over the cells being typed in.
 * The draft is kept on the phone until it is saved (see the event page), so a
 * save button that has to be scrolled to costs nothing that is typed.
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-panel border-t border-border bg-background px-inset py-3">
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
