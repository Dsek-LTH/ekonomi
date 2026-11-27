# Layout and density

The app is a working tool, so pages are dense: as much as fits without
crowding. These rules keep every form and card on one scale.

## Spacing

- A card's body is `px-inset py-4` (`CardBody`). A dialog's body is the same
  (`ModalBody`).
- Fields are 12px apart, both ways: `gap-3` in a grid, `space-y-3` in a
  column. Labels stay above their field, at 12px (`text-xs`, in `Field`).
- A required field has a star on its name. An optional field has no marker:
  the absence of the star says it.
- Every control that can sit beside another is one height: 32px from sm up,
  40px on a phone. That is fields, comboboxes, buttons of both sizes, menu
  buttons, the segmented control and the toggles. `size="sm"` changes padding
  and text, never height.
- Larger gaps are for separating whole cards on a page (`space-y-4` and up),
  never fields inside one.
- A field that is rarely needed goes under a folded "Ytterligare uppgifter",
  open by default only when the record already uses it.

## Surfaces and lines

- A card is a surface, not a box (`SURFACE` in components/ui/card.tsx): the
  step from the canvas and `--shadow-card` draw it. Its border is
  `--color-edge`, transparent on a light page and a hairline in dark, where a
  shadow does not read. A menu or popover floats instead: a border and
  `--shadow-pop`.
- Corners are 2, 6 and 10px (mark, control, panel), so a card rounds clearly
  more than what is in it.
- Two line weights. `--color-border` is structural: a table's head, a total,
  the band under the page's header. `--color-divider` is everything inside a
  card: rows of a list, parts of a record, rows of a setting. Where spacing
  already separates two things (a list's tabs, toolbar and pagination, a
  card's title and body) there is no line.
- A grid that is typed in (the kontering, the allocation, a budget sheet, a
  stocktake) keeps its spreadsheet frame and column rules.
- Nothing is a box inside a box. A status inside a card is a line in it, and a
  card with nothing to hold is not drawn: an empty list's sentence stands on
  the page.
- On a phone (below sm) a page's card runs to the screen's edges, with no side
  margin, corners or side edge. A card in a card or in a dialog keeps its
  margins.

## Columns

- A form beside the document panel decides its columns by its own width, not
  the screen's: put `@container` on the card and use `@md:` / `@xl:` /
  `@2xl:`, never `sm:` / `lg:`. The panel takes half the page, so a viewport
  breakpoint gives a narrow form too many columns or too few.
- Switch to more columns as early as the fields still read: four short fields
  (dates, numbers, amounts) per row from `@xl` (36rem), a label column plus
  a field from `@md` (28rem). `@2xl` (42rem) only where a row holds wide
  content, such as the utlägg booking's three columns.
- A table of inputs (the allocation editor, `CONTROL_CELL`) turns from stacked
  cards into a table at `@xl`.

## Field widths

A field is as wide as what goes in it, not as wide as the page. `width` on
`Input`, `SuffixedInput`, `DateInput`, `AmountInput` and `Combobox` takes one of
`FIELD_WIDTH` (components/ui/field.tsx), from `sm` up:

| Width  | Size       | For                                                                                       |
| ------ | ---------- | ----------------------------------------------------------------------------------------- |
| `xs`   | 5rem       | a page size, a percentage, a count, months                                                |
| `sm`   | 10rem      | a date, an amount, a clearing number, OCR (the default for `DateInput` and `AmountInput`) |
| `md`   | 14rem      | an account, a cost centre, a name, an account number                                      |
| `full` | the column | free text, a description, search, the supplier (the default for the rest)                 |

On a phone every field takes the row. A field in a table cell, or in a grid
whose columns have to line up (the kontering head beside the document), takes
`full` and leaves the width to the column. Short fields that belong together
stand side by side at their own widths rather than in halves of the card. A list's toolbar puts the filters and the search (18rem) at the start and
the dates and the list's action at the end, so it is weighted at both ends at
any width.

## Warnings

Where a warning goes depends on what it is about. None of them is a filled box,
and danger differs from warning in colour only (`components/ui/notice.tsx`).

- **One field or value:** right under it, as small coloured text: a Field's
  `error`, or `Issue`. An overdue date says so on the date itself.
- **The next step:** beside the page's main button, as `Issues` (the bankgiro
  that differs before Skicka till Fortnox, the voucher warnings before
  Bokför). Something that stops the step disables the button and gives the
  reason on it.
- **The whole page:** `Notice`, one slim line with a coloured bar on the left,
  at the top: changed by somebody else, sent back with a comment, not set up,
  the mail intake failing.
- **Information** (`Notice tone="info"`) is muted text with no bar: who else
  has the page open, a draft brought back. Not something to act on.
