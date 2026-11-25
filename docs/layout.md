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
