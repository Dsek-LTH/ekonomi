# Lager: alcohol, café and the board's tab

The design, and what of it is built. Sections 1 to 9 are the design as agreed.
Where the build departs from it, the list below says so and is what holds.

## Status (2026-11-12)

Built, uncommitted in main: the `Stock` and `StockGroup` models and the
migration, per-stock capabilities, the alcohol pages under `/stock/alcohol`,
the café stock with Påfyllning, Inställningar -> Lager, the posting layer with
Lagervärde and reconciliation, the board's tab with prices, and the year-end
invoices.

Where the build differs from the text below:

- What a stock does (nights, the ladder, the restaurangrapport, refills, board
  withdrawals) is fixed in `lib/stock/stocks.ts`, not columns on `Stock`. The
  row holds only what a person chooses.
- A correction is a voucher of its own (`StockVoucherKind.CORRECTION`), dated
  the day it is made, with one row pair per day it puts right. It does not
  ride in the oldest unposted day's voucher. A day's voucher then only ever
  holds that day.
- There is no separate `OPENING` voucher. Starting up and the year-end
  reconciliation are the same action, "Bokför skillnaden" on Lagervärde, which
  makes a `RECONCILIATION` voucher on a chosen date.
- A waiting day has no page of its own. Its voucher rows open in place on
  Lagervärde, with a link to that day's movements in the stock's history.
- A withdrawal's quantity is not edited. It is removed and logged again.
- Nothing is sent per day. A bookkeeper picks a date on the stock's Bokföring
  page (`/stock/[stock]/bookkeeping`, which replaces Lagervärde) and every day
  not yet sent, up to and including it, goes as one voucher dated that day
  (`Lager Café t.o.m. 2026-11-30`). Alcohol is booked after an occasion, the
  café once a month. Anything dated on or before the last such date that
  changes later is a correction, sent by hand. The kind is still `DAILY`. A
  posting line's `forDate` keeps each day's share, so corrections are found
  per day as before. There is no "send everything" button and no ordering
  rule between days. This holds over section 3's "one voucher per stock and
  day" and section 4's Lagervärde page.
- Påfyllning is replaced by Flytta, and `CAFE_STOCK_REFILL` is gone. Stock
  goes to places, each with its own cost centre, and who may log a move is
  set per place by Authentik group. See section 11, which holds over what
  sections 4, 5 and 7 say about refills.

Not built yet:

- [ ] The price paid per row on the delivery sheet, and its link to the
      utlägg or leverantörsfaktura (`StockEntry.supplierInvoiceId` exists,
      nothing writes it). Until then a delivery is still priced from the
      product's cost price.
- [ ] The purchase matching view in the alcohol reconciliation (Fortnox
      debits beside deliveries). The per-account difference is shown.
- [ ] The Typst underlag attached to each voucher.
- [ ] Reading Fortnox's locked period. Today a day is its own voucher while
      Fortnox has a financial year for its date, and Fortnox's own refusal is
      what stops a locked one.
- [ ] The bokslut checks `STOCK_POSTED` and `BOARD_INVOICED`, and
      `STOCKTAKE_AT_YEAR_END` per stock.
- [ ] The Översikt rows (days to book, a member's balance).
- [ ] The räkenskapsår narrowing of the stock lists.
- [ ] The café Sheets and board Excel imports.
- [ ] A coach-mark tour for the new pages.

To check before first use against the real Fortnox company:

- The customer and invoice calls in `lib/fortnox/index.ts` (`listCustomers`,
  `createCustomerInvoice`, `findCustomerInvoice`) were written without being
  able to read Fortnox's reference, which is served by a script. Watch the
  first invoice run and compare the utkast with what the preview said.
- The service connection and every personal Fortnox login must be made again
  to get the `customer` and `invoice` scopes.

A design, as agreed 2026-11-11. It extends the alcohol stock to a second stock (the
café), posts each stock's value change to Fortnox per day, and replaces the
board's Excel sheet with withdrawals that are invoiced at year end.

Decided with the skattmästare 2026-11-11, and not verifiable from the code:

- Alcohol purchases are booked straight to a stock (balance) account.
- Café purchases are expensed to a cost account. Lager is adjusted at year end.
- The section is not VAT registered. Stock is valued at the price paid
  including moms, and the board's invoices carry no moms.
- The board takes from the café stock only.
- A board invoice is a sale: it credits a revenue account at board price, and
  the cost stays where the daily voucher put it.
- The stock account follows the product type, not the stock. Alcohol has four
  (beer, cider, wine, spirits), alkoholdrycksliknande is a fifth type of its
  own, and the café's non-alcoholic drinks have theirs.
- The cost side is per type as well: each type has its own cost account for
  what left for sale.
- The café stock holds drinks only for now, so it has one type.
- The amount booked on the alcohol stock accounts includes pant and excludes
  freight. A product's cost price, and the price paid on a delivery, is
  therefore per unit with pant and without freight.
- Board invoices arrive in Fortnox as utkast.
- The revisor accepts corrections in a later voucher, and the café's
  take-into-stock credit against the purchase account.
- Spoilage and stocktake differences are charged on the type's own cost
  account, with an optional separate account per type for each.

No account number or cost centre is assumed below. Each one is a setting that
is null until somebody chooses it, the way `BookkeepingSettings` works, and
nothing is exported for a stock until its settings are complete.

## 1. Where the current alcohol model gets in the way

Most of it carries over unchanged: on hand is the sum of `StockEntry`, value
is the sum of `valueDeltaOre` at moving average cost, `StockEvent` groups a
night, `StockChange` records every edit, and an open bottle is worth nothing.
Five things have to change.

1. **The log is not append-only, and past values move.** The schema header
   says rows are never updated. In practice `PATCH` and `DELETE` on
   `/api/stock/entries/[id]` and the event sheet edit rows in place, and
   `replayProduct` then rewrites `valueDeltaOre` on every later row of that
   product. That is right for a lagerbokföring and wrong as a basis for
   vouchers, because a delivery backdated to October changes what November's
   withdrawals cost after November was exported. The fix is not to freeze the
   log. It is a posting layer that remembers what was sent per day and posts
   the difference (section 3).
2. **There is one stock.** Products, events, settings and the two capabilities
   are global. A `Stock` model is needed, and everything hangs off it.
3. **`DrinkCategory` is required on every product.** It exists for the
   restaurangrapport. Café products have none, so it becomes nullable and is
   required only in a stock that files the report.
4. **A delivery is priced from the product, not from the receipt.**
   `unitCostOre` is copied from `StockProduct.costPriceOre` when the row is
   written. Since alcohol purchases hit the stock account in Fortnox at the
   amount actually paid, every stale cost price becomes a difference between
   the app and the books. The delivery form should take the price paid per
   row.
5. **Nothing leaves stock without an event.** `CHECKOUT` requires a
   `StockEvent`. A fridge refill and a board withdrawal are neither a night
   nor expected back, so they get their own kinds.

Housekeeping found on the way: `src/lib/stock/measure.ts` no longer exists,
the header of `stock.prisma` still describes weighing bottles in grams, and
the `StockEvent` doc comment sits above `StockChange`.

## 2. Data model

### New: `Stock`

One row per stock. Two rows to start with: `alcohol` and `cafe`.

| Field | Meaning |
|---|---|
| `slug`, `name` | `alcohol` / `cafe`, used in paths |
| `usesEvents` | The bar's checkout and return sheet. Alcohol only |
| `usesOpenLevels` | The 80/60/40/20 ladder. Alcohol only |
| `filesRestaurangrapport` | Requires `category` on its products |
| `allowsBoardWithdrawals` | Café only |
| `purchaseMode` | `CAPITALISED` (purchases already debit the stock account in Fortnox) or `EXPENSED` (purchases were booked as a cost) |
| `consumptionCostCenterId` | The cost centre goods that left for sale are charged on, when the event names none. The account is on the group |
| `purchaseOffsetAccount`, `purchaseCostCenterId` | `EXPENSED` only: credited when a delivery is taken into stock |
| `lossCostCenterId` | Cost centre for spoilage in storage. The account is on the group |
| `countDiffCostCenterId` | Cost centre for stocktake differences and reconciliation. The account is on the group |
| `boardCostAccount`, `boardCostCenterId` | Cost of what the board took |
| `boardSalesAccount`, `boardSalesCostCenterId` | Revenue on the board's invoices |
| `voucherSeries` | Chosen per stock and required; there is no shared default |
| `postingStartsOn` | First day that produces a voucher. Null means posting is off |
| `expiryLeadDays` | Moves here from `StockSettings`, which is dropped |

### New: `StockGroup`

The product type, and the thing a stock account hangs on. A stock has several.

| Field | Meaning |
|---|---|
| `stockId`, `name` | "Öl", "Cider", "Vin", "Sprit", "Alkoholdrycksliknande" in alcohol. "Dryck" in the café |
| `stockAccount` | The balance account this type's value lives on |
| `consumptionAccount` | The cost account this type is charged on when it leaves for sale |
| `lossAccount` | Optional. Where this type's spoilage is charged. Null means `consumptionAccount`, so spoiled wine lands on the wine account |
| `countDiffAccount` | Optional. Where this type's stocktake difference is charged. Null means `consumptionAccount` |
| `sortOrder` | |

It is a table and not a column on `DrinkCategory` because the café needs types
too and has no drink category.

In the alcohol stock the only classification is Folkhälsomyndigheten's
(`DrinkCategory`, decided 2026-11-27). Its groups are one per drink type and only
hold the accounts: the product form asks for the drink type alone, the routes
put the product in that drink type's group (`categoryGroup` in
lib/server/stock-product-guard.ts, which makes the group on first use), the
settings show one row per drink type with no way to add another, and the list
filters by drink type. A group left over from before, with no drink type, can be
removed once it is empty. In the café the group is picked on the product.

Spoilage follows the type: wine that spoils is charged on the wine account,
beer on the beer account. Stocktake differences are treated the same way,
since a shortfall at a count is loss nobody wrote down. Both have their own
optional column so they can be pointed elsewhere without a schema change.
Only the board's cost stays one account per stock, and the café has one type
anyway.

### Changed

- `StockProduct`: add `stockId` (required, immutable after the first entry),
  `groupId` (required, must belong to the same stock), `packSize Int?` (24 for a flak, so a refill can be typed in packs).
  `category` becomes nullable, with a CHECK that it is set when the stock
  files the restaurangrapport.
- `StockEntryKind`: append `ISSUE` (left storage for sale, not expected back:
  a fridge refill) and `WITHDRAWAL` (taken by a board member). Appended last,
  as `SPOILAGE` was, so Postgres does not rewrite the type.
- `StockEntry`: add `supplierInvoiceId` beside `expenseId`, so a delivery can
  point at either document. Add `batchId String?` (a client-made UUID) with
  `@@unique([batchId, productId, kind])`, which makes a phone's retried
  submit harmless.
- `StockEvent`: add `stockId`, and `costCenterId` (optional). A pub and a
  sittning can then charge different cost centres. Null falls back to the
  stock's `consumptionCostCenterId`.
- `Capability`: rename `STOCK_VIEW` / `STOCK_MANAGE` to
  `ALCOHOL_STOCK_VIEW` / `ALCOHOL_STOCK_MANAGE` (a Postgres
  `RENAME VALUE`, existing `RoleCapability` rows follow). Add
  `CAFE_STOCK_VIEW`, `CAFE_STOCK_REFILL`, `CAFE_STOCK_MANAGE`, `BOARD_TAB`.
- `Role`: add `CAFE_STOCKARE` and `STYRELSE`, mapped from Authentik groups
  like `STOCKARE` is.
- `Verification`: a third owner column, `stockVoucherId`. The "exactly one
  owner" CHECK is extended. A customer invoice needs none, since it is not a
  voucher.
- `ClosingCheck`: `STOCKTAKE_AT_YEAR_END` is evaluated per stock. Add
  `STOCK_POSTED` and `BOARD_INVOICED`.
- User-token Fortnox scopes gain `invoice` and `customer`. Service scopes gain
  the same for the duplicate and customer lookups.

### New: posting

```
StockVoucher
  id, stockId, date (Date), kind: DAILY | OPENING | RECONCILIATION
  valueAfterOre          the app's value of the stock at the end of `date`, when frozen
  exportClaimedById, exportClaimedAt, exportClaimState   (the utlägg lock, same three states)
  verification           Verification? (holds the Fortnox series, number, year, exportedAt)
  @@unique([stockId, date, kind])

StockPostingLine
  id, voucherId
  forDate (Date)         the movement day this amount belongs to (differs from the voucher's date on a correction)
  class: PURCHASE | CONSUMPTION | BOARD | LOSS | COUNT
  groupId                which type's stock account the amount moved
  costCenterId?
  amountOre              signed effect on the stock's value
  @@index([voucherId]), @@index([forDate])
```

`StockPostingLine` is the memory of what was sent. Rows exist only for
vouchers that were frozen for export. An unposted day has no rows anywhere:
it is computed from the log each time it is shown.

### New: the board's tab

```
BoardPrice
  id, productId, priceOre, validFrom (Date), createdById, createdAt
  @@unique([productId, validFrom])        append-only, the table is its own history

BoardWithdrawal
  id, entryId (unique, the WITHDRAWAL StockEntry), memberId (User)
  qty, unitPriceOre                        the board price on the day, captured
  loggedById                               differs from memberId when the treasurer logs for somebody
  customerInvoiceLineId?                   set once invoiced, and the row is locked from then on

CustomerInvoice
  id, source: BOARD_TAB, customerId (User), fiscalYearId, sequence
  invoiceDate, totalOre
  fortnoxCustomerNumber, fortnoxDocumentNumber, exportedAt, exportedById
  exportClaimedById, exportClaimedAt, exportClaimState
  @@unique([source, customerId, fiscalYearId, sequence])

CustomerInvoiceLine
  id, invoiceId, productId?, description, qty, unitPriceOre, amountOre, account, costCenterId?
```

`CustomerInvoice` is named for what it is, not `BoardInvoice`, because
kundfakturor are ekonomi's next area and avtalaD's fakturabegäran will be a
second `source`. The board's tab only needs the columns above.

## 3. Stock value per day, and the voucher

### The value

Unchanged: a stock's value is the sum of `valueDeltaOre` over its products'
entries, and a day's change is that sum over rows with `occurredAt` on the
day. Each row falls in one class:

| Class | Entry kinds | Posted when |
|---|---|---|
| `PURCHASE` | `PURCHASE` | only if `purchaseMode = EXPENSED` |
| `CONSUMPTION` | `CHECKOUT`, `RETURN`, `ISSUE` | always |
| `BOARD` | `WITHDRAWAL` | always |
| `LOSS` | `SPOILAGE` | always |
| `COUNT` | `COUNT`, `CORRECTION` | always |
| (none) | `WASTE` | never. It carries no value, the checkout already took it |

`expected(day, class, group, costCentre)` is the sum of `valueDeltaOre` for
that bucket. The group is the product's. The cost centre is the event's for
bar rows, otherwise the class's setting on the stock.

### The lines

For each bucket with a non-zero amount `a` (negative means value left):

- the class's account gets debit `-a` when `a < 0`, credit `a` when `a > 0`.
  For `CONSUMPTION`, `LOSS` and `COUNT` that is the group's account, for
  `PURCHASE` and `BOARD` the stock's setting
- the group's stock account gets the same amount the other way round

Lines that share an account and cost centre are then added together. So a
night that sold beer and spirits credits two stock accounts in one voucher,
and debits two cost accounts, in one voucher. It is still one voucher per
stock and day, the voucher always balances, and all arithmetic is whole öre.
"stockAccount" and "consumptionAccount" in the examples below mean the
accounts of the group each product is in.

**Alcohol** (`CAPITALISED`). A pub night takes out 4 000 kr and brings back
1 500 kr the next day, and a crate worth 300 kr is found broken:

| Day | Debit | Credit |
|---|---|---|
| Fri | consumptionAccount 4 000 (event's cost centre) | stockAccount 4 000 |
| Sat | stockAccount 1 500 | consumptionAccount 1 500 |
| Sat | the type's loss account 300 | stockAccount 300 |

A delivery produces nothing, because the utlägg or leverantörsfaktura already
debited the stock account. That is how purchases are not double counted.

**Café** (`EXPENSED`). A delivery worth 2 400 kr arrives, the fridges are
filled with 900 kr of drinks, and the board takes 60 kr:

| Debit | Credit |
|---|---|
| stockAccount 2 400 | purchaseOffsetAccount 2 400 |
| consumptionAccount 900 | stockAccount 900 |
| boardCostAccount 60 | stockAccount 60 |

The purchase was already a cost in Fortnox, so taking it into stock credits
that cost back, and it becomes a cost again on the day it leaves storage. If
`purchaseOffsetAccount` and `consumptionAccount` are set to the same account
and cost centre, the two collapse into one net line, which is the usual
lagerförändring posting. Purchases are not double counted because the app
never books the purchase itself, only its move onto the balance sheet.

### Days with no movement

No voucher and no row. A list of empty vouchers in Fortnox helps nobody, and
because drafts are computed rather than stored there is nothing to keep in
step.

### Corrections to a day that was already exported

For any day `X` with an exported voucher,
`delta(X, bucket) = expected(X, bucket) now - sum of StockPostingLine for X`.
The bucket includes the group, so moving a product to another group shows up
as a correction that moves its value from one stock account to the other.
That is the right posting, and the product form says so before it saves.
Changing a group's account number does not move anything: it applies to days
posted afterwards.
A non-zero delta is posted as a correction line, with `forDate = X`, in the
**oldest unposted day's** voucher, under the text `Rättelse {X}`. If no day is
waiting, a correction-only voucher is dated yesterday.

Consequences, all intended:

- Fortnox vouchers are never edited or voided by the app.
- A backdated delivery that shifts the moving average on forty later
  withdrawals by a few öre each produces forty correction amounts in one
  voucher, not forty vouchers.
- After every export, the stock account in Fortnox has moved by exactly what
  the log says, to the öre, whatever was edited meanwhile.
- A correction lands on the day it was discovered, not the day it belongs to.
  The app still shows the true value per day (Historik, Statistik).

A day that had nothing when it was passed over, and has movement now (Friday's
pub typed in on Monday), is simply an unposted day and gets its own voucher on
its own date. Only when that date is in a locked period or a closed year does
it travel as a correction instead.

Days are posted oldest first per stock. A day cannot be exported while an
earlier one is waiting or uncertain.

### Reconciliation

Reconciliation is per stock account, so per group: the app's value of the
group's products against the Fortnox balance on its account.

- Café: once every day is posted, the two are equal. Any difference is
  something booked on the account by hand.
- Alcohol: the difference is purchases as booked in Fortnox minus deliveries
  as logged in the app. Per account, this also catches a purchase konterad on
  the wrong one (beer booked on the wine account shows as a surplus there and
  the same shortfall on beer). The reconciliation view lists the debits on
  each stock account from the ledger mirror next to the `PURCHASE` rows that
  point at the same utlägg or levfaktura, so a missing delivery or a wrong
  price can be found row by row and fixed (the existing audited price
  correction).

### The year-end stocktake

The stocktake stops being the event that moves the value and becomes a check
on it.

1. Count each stock on the balance day (the existing stocktake page). The
   `COUNT` rows are dated that day.
2. Post every day through the balance day. The count's difference goes out in
   that day's voucher against each type's `countDiffAccount`.
3. Open the reconciliation. Whatever still separates the Fortnox balance from
   the app's value is booked with one `RECONCILIATION` voucher dated the
   balance day, one line per stock account. For the café this should be zero.
4. The bokslut checklist ticks `STOCKTAKE_AT_YEAR_END` per stock,
   `STOCK_POSTED` (no day waiting in the year and the balances agree) and
   `BOARD_INVOICED`.

The manual year-end lagerjustering is no longer made.

### Starting up

`postingStartsOn` is set per stock. An `OPENING` voucher dated the day before
brings the Fortnox balance to the app's value on that date, against
each type's `countDiffAccount`. Best done right after a physical count. Starting on the
first day of a räkenskapsår, straight after the year-end stocktake, makes the
opening voucher the same thing as the year-end adjustment made today.

## 4. Pages

Two rail groups replace Lager, because the two stocks have different people
and different pages. Each is hidden from whoever holds neither capability.
`/stock` moves to `/stock/alcohol` and is not kept as a redirect.

```
Alkohollager                                   bar staff (STOCKARE)
  Produkter   /stock/alcohol
  Tillfällen  /stock/alcohol/events, /stock/alcohol/events/[id]
  Historik    /stock/alcohol/history            view: Rörelser | Statistik
  (Leverans, Inventering and the product page as today, under /stock/alcohol)

Cafélager                                      café staff
  Påfyllning  /stock/cafe/refill
  Produkter   /stock/cafe
  Historik    /stock/cafe/history               view: Rörelser | Statistik

Styrelseborder                                 board members, treasurer
  Logga        /board                           board members, treasurer
  Mina uttag   /board/history                   board members
  Fakturering  /board/invoices                  bookkeepers
    /board/invoices/[memberId]                  one person's tab
  Priser       /board/prices                    treasurer only

Bokföring
  Lagervärde  /stock-vouchers/alcohol, /stock-vouchers/cafe   (now /stock/[stock]/bookkeeping, see Status)
    tabs: Att bokföra | Bokförda | Alla
    /stock-vouchers/[stock]/[date]
  Bokslut     /closing                          (as today)
```

- **Påfyllning** (café staff, on a phone). Opens straight on the list, most
  refilled first, with a search field and barcode scan (`by-ean` exists).
  Each row is a product name and a stepper, in packs when the product has a
  `packSize` and in units otherwise. One "Spara påfyllning" button at the
  bottom writes all rows as `ISSUE` entries dated today. The unsent refill is
  kept in `localStorage` so a dead spot in the storage room loses nothing, and
  the `batchId` makes the retry safe. After saving it shows what was logged
  with an "Ångra" for the batch.
- **Produkter** (both stocks). The existing list, delivery, stocktake and
  product page, driven by the stock's flags: no ladder, no events and no
  drink category in the café. The delivery form gains a price-paid field per
  row, labelled as including pant and not freight, and a link to the utlägg
  or levfaktura.
- **Logga** (board member, treasurer). Logging and invoicing are separate
  pages, so logging is fast: `/board` opens straight on the sheet, with the
  same search, scan and stepper rows as Flytta
  (`components/stock/product-stepper.tsx`) and the same docked button, only
  with products that have a board price, showing the price. Below it what the
  reader logged today with "Ta bort". The treasurer picks whose tab. The scan matches the barcode
  in the browser, since a board member cannot read the stock's own lookup.
- **Mina uttag** (board member). A running tab, built from the record
  pages' parts (`board/tab-view.tsx`): a fact strip (Att betala, Öppen sedan,
  Uttag), the open tab as a table with one row per product that opens into
  each time it was taken (where today's can be taken back), and Tidigare
  notor, one row per invoice opening into its lines. A member who has left
  the board still reaches this page while it holds rows.
- **Fakturering** (bookkeepers). Per person: a table with one row per member
  (avatar, a "Har lämnat styrelsen" tag, open withdrawals, what they owe),
  who owes most first, searchable, with the total as its summary. The
  toolbar's buttons are "Logga åt någon" and "Fakturera styrelsen {year}". A
  row opens `/board/invoices/[memberId]`: the same fact strip, open tab and earlier tabs as
  the member's own Mina uttag, with "Logga uttag" (Logga with the member
  picked) and "Fakturera nu" for somebody leaving before the year's end.
- **Priser** (treasurer). One row per café product: cost today, board price,
  valid from. Editing a price adds a `BoardPrice` row. A board price below
  the product's cost is marked with a warning, and can still be saved. The history of a
  product's prices opens from the row.
- **Lagervärde** (bookkeepers). Per stock, the days waiting with their amount,
  corrections marked. Toolbar: "Bokför N dagar". Above the table, the
  reconciliation band: app value, Fortnox balance, difference, and "Öppna
  avstämning". The day page shows the voucher lines exactly as they will be
  sent, and under them the movements that make them up, per product.
- **Översikt**. Bookkeepers get one grouped row per stock, "N lagerdagar att
  bokföra". A board member sees their balance. Near year end the treasurer
  gets "Fakturera styrelsen".
- **Inställningar -> Lager**. The `Stock` settings above, per stock, and
  its groups with their accounts.

Stock lists are narrowed by the header's räkenskapsår like every other dated
list, which also retires the "per datum" picker noted in `navigation.md`.

## 5. API

Existing routes stay under `/api/stock` and take the stock from the product
or event they touch. List routes take `?stock=`. "View" and "manage" below
mean the capability of that stock.

| Method and path | Does | Who |
|---|---|---|
| `GET /api/stock/stocks` | The stocks the caller can see, with flags | view of any |
| `PATCH /api/stock/stocks/[slug]` | Accounts, cost centres, series, start date | `SETTINGS` |
| `GET, POST /api/stock/groups?stock=`, `PATCH, DELETE /api/stock/groups/[id]` | The product types and their accounts. A group with products cannot be deleted | view / `SETTINGS` |
| `GET, POST /api/stock/products`, `GET, PATCH /api/stock/products/[id]` | As today, with `stockId` | view / manage |
| `GET, POST /api/stock/entries`, `PATCH, DELETE /api/stock/entries/[id]` | As today. Refuses `WITHDRAWAL` rows, which have their own route | view / manage |
| `POST /api/stock/refills` | `{ stock, batchId, occurredAt, lines[{ productId, units }] }`, writes `ISSUE` rows in one transaction, replays the products | `CAFE_STOCK_REFILL` or manage |
| `DELETE /api/stock/refills/[batchId]` | Undo a batch, audited | its author the same day, else manage |
| `GET /api/board/withdrawals?scope=&tab=` | The caller's, or everyone's | `BOARD_TAB` or own rows / `BOOKKEEPING` |
| `POST /api/board/withdrawals` | `{ batchId, lines[{ productId, qty }], memberId? }`. Writes the `WITHDRAWAL` entry and the `BoardWithdrawal` with the price valid on the day. `memberId` only for the treasurer | `BOARD_TAB` / `BOOKKEEPING` |
| `PATCH, DELETE /api/board/withdrawals/[id]` | Change quantity or remove, until invoiced | the member the same day, else `BOOKKEEPING` |
| `GET, POST /api/board/prices` | The price list, and a new price from a date | `BOARD_TAB` to read / `BOOKKEEPING` |
| `GET /api/stock-vouchers?stock=&tab=` | Days waiting (computed) and vouchers posted | `BOOKKEEPING_VIEW` |
| `GET /api/stock-vouchers/[stock]/[date]` | The lines and the movements behind them, with a fingerprint | `BOOKKEEPING_VIEW` |
| `POST /api/stock-vouchers/[stock]/[date]/export` | Freeze and send one day. Body carries the fingerprint the caller saw | `BOOKKEEPING` + Fortnox login |
| `POST /api/stock-vouchers/[stock]/export` | Every waiting day, oldest first, stopping at the first failure | same |
| `POST /api/stock-vouchers/[stock]/[date]/resolve` | For an uncertain export: look in Fortnox, adopt the voucher or release the day | `BOOKKEEPING` |
| `POST /api/stock-vouchers/[stock]/[date]/unexport` | The voucher was voided in Fortnox by hand. Drops the posting lines so the day is computed again | `EXPORT_UNDO` |
| `GET /api/stock-vouchers/[stock]/reconciliation` | App value, Fortnox balance, and the alcohol purchase matching | `BOOKKEEPING_VIEW` |
| `POST /api/stock-vouchers/[stock]/opening`, `.../reconcile` | The `OPENING` and `RECONCILIATION` vouchers | `BOOKKEEPING` + Fortnox login |
| `GET /api/board/invoices?year=` | Preview: per member, lines and total, and what blocks each | `BOOKKEEPING_VIEW` |
| `POST /api/board/invoices` | `{ year, memberIds? }`. Creates the invoices and sends each to Fortnox. The one button | `BOOKKEEPING` + Fortnox login |
| `POST /api/board/invoices/[id]/export` | Retry one that failed | same |

No cron route is needed for posting, since a waiting day is computed on read.

## 6. Fortnox

### Token

Exports use the bookkeeper's own token (`userToken`), as decided 2026-11-06.
So the app prepares each day's voucher by itself, and a bookkeeper sends them
with "Bokför N dagar". Reads (the duplicate check, the account balance, the
customer lookup, the locked period) use the service connection.

### Sending a day

1. Gate: `BOOKKEEPING`, a live Fortnox login, the stock's settings complete, a
   series chosen, the date in an open year and outside the locked period, no
   earlier day waiting.
2. In one transaction with the `Stock` row held `FOR UPDATE`: compute the
   lines, compare with the fingerprint the bookkeeper saw (409 when they
   differ, so nobody sends a figure they did not look at), write
   `StockVoucher`, its `StockPostingLine` rows and the `Verification`, and
   take the claim.
3. Duplicate check through the service token, the way
   `lib/income/duplicate.ts` does: a voucher in the series on that date whose
   text is `Lager {stock} {date}`. Found means adopt its number and send
   nothing.
4. `markSent`, `createVoucher`, `recordExport`. These are the existing helpers
   in `lib/fortnox/export.ts` and `lib/server/export-claim.ts`, generalised
   from the utlägg.
5. Attach a Typst-rendered underlag (movements per product, with the value
   before and after), best effort.

### Never the same day twice

Three independent guards: `@@unique([stockId, date, kind])`, the claim states
(`CLAIMED`, `SENT`, `UNCERTAIN`), and the duplicate check against Fortnox
itself. And one that makes a slip harmless: because every voucher is "expected
minus already posted", a second run for a posted day computes zero.

### Failures

- Refused before anything was sent (no login, locked period, a retired cost
  centre): the frozen voucher is deleted, the day stays in Att bokföra with
  the reason, and the next attempt recomputes it.
- No clear answer from Fortnox: `UNCERTAIN`. The day and every later day of
  that stock are blocked until somebody presses "Kontrollera i Fortnox"
  (`resolve`).
- The attachment failed: the voucher stands, and the page says the underlag
  has to be attached by hand.
- A batch stops at the first failure and reports how far it got.

### Board invoices

"Fakturera styrelsen {year}" opens a preview: each member with uninvoiced
withdrawals dated in the year, their lines grouped by product and price, the
total, and anything missing. On confirm, per member and independently:

1. Create the `CustomerInvoice` and its lines, and point the withdrawals at
   them. From here they are locked.
2. Send to the Fortnox customer the treasurer picked for the member in the
   preview. The picker reads Fortnox's customer register (service token) and
   suggests the customer used last time, else the only one with the member's
   email or exact name. The app never creates customers: a missing one is
   added in Fortnox first, then the list is fetched again. The run does
   nothing until every member has a customer.
3. Look for an invoice already carrying this `CustomerInvoice` id as its
   external reference. Found means adopt it.
4. Create the invoice in Fortnox as an utkast, not booked and not sent: one
   row per line with `boardSalesAccount`, the cost centre, quantity, price and
   no moms. The treasurer reviews, books and sends it from Fortnox, as with a
   levfaktura utkast.

The same claim states apply, so pressing the button twice, or again after a
failure, only sends what has not gone. An invoice that does not reach Fortnox
stays, with its withdrawals locked, and shows as "Inte bekräftad av Fortnox"
under Tidigare notor. The next run sends it again, or the treasurer sends it
from its row on the member's page (`POST /api/board/invoices/[id]/send`),
which does the same steps 2 to 4. Before sending it opens a dialog with the
invoice's customer, sales account, cost centre and invoice date, so whatever Fortnox
refused can be changed first. A refusal is shown in the dialog. A withdrawal logged after the run goes on a
second invoice (`sequence` 2) the next time the button is pressed.

## 7. Permissions and audit

| Who | Role | Capabilities |
|---|---|---|
| Bar staff | `STOCKARE` | `ALCOHOL_STOCK_VIEW`, `ALCOHOL_STOCK_MANAGE` |
| Café workers | `ORDINARIE` in a café group | `CAFE_STOCK_REFILL` |
| Café leads | `CAFE_STOCKARE` | `CAFE_STOCK_VIEW`, `CAFE_STOCK_REFILL`, `CAFE_STOCK_MANAGE` |
| Board members | `STYRELSE` | `BOARD_TAB` |
| Treasury | existing | both views, `BOOKKEEPING` for prices, posting and invoicing, `FORTNOX_LOGIN` to send |
| Revisorer | `REVISOR` | every view, `BOOKKEEPING_VIEW` |

Keeping the stock and posting it stay with different people, as today:
"lagerbokföring is not bookkeeping". That separation is the two-person rule
here, so a stock voucher has no kontera-then-granska step. Its figures are
derived, and nobody types them.

Audit trail:

- Every entry written, changed or removed: `StockChange` (already there,
  now also for `ISSUE` and `WITHDRAWAL`).
- Product edits: `StockProductChange`.
- Board prices: `BoardPrice` is append-only with its author.
- A withdrawal logged for somebody else: `loggedById`.
- What was posted and why: `StockPostingLine` with `forDate`, the
  `Verification` with its Fortnox number, who claimed and sent it, and the
  attached underlag.
- Stock settings: a small `StockSettingsChange` (field, from, to, who, when),
  the same shape as `StockProductChange`. An account changed mid-year only
  affects days posted afterwards.

## 8. Migration

**Alcohol.** One migration: create the two `Stock` rows and the alcohol
groups (Öl, Cider, Vin, Sprit, Alkoholdrycksliknande, accounts left null) and
the café's one (Dryck), backfill `stockId` on every product and event to
`alcohol` and `groupId` from the category, one group per `DrinkCategory`
value, move `expiryLeadDays`,
rename the capabilities, make `category` nullable with the CHECK. No entry is
touched and no value changes. Verify by running `/api/stock/revalue`, which
must report zero rows written and the same total before and after. Posting
stays off until `postingStartsOn` is set.

**Café history from Google Sheets.** A script in `scripts/import/`, beside
`budget-json.ts`, reading CSV exports of the sheets:

1. A mapping file from each product name in the sheet to a `StockProduct`
   (created first, with EAN, pack size and cost price).
2. The last year-end count becomes a `COUNT` row per product on that date.
   That is the baseline.
3. Each delivery after it becomes a `PURCHASE`, each refill an `ISSUE`, with
   the sheet's date as `occurredAt`, the note "Importerad från Google
   Sheets", and the sheet row as `batchId` so the import can be rerun.
4. A dry run prints what it would write, the rows it could not map, and the
   resulting on hand per product next to the sheet's own balance.
5. After the import, a physical count in the app. Then set `postingStartsOn`
   and make the `OPENING` voucher.

Only the current year is imported, from the last stocktake. Older years are
already closed in the books and add nothing the count does not replace.

**The board's Excel.** This year's rows are imported the same way as
`WITHDRAWAL` entries with the board price that applied, so one year-end run
covers the whole year. If the sheet is too loose for that, the alternative is
to invoice the Excel part by hand one last time and start the tab empty.

## 9. Open questions, and the calls made

Calls made, with the alternative:

1. **Corrections ride in the next voucher** instead of a supplementary
   voucher on the original date. Chosen because a moving average ripples, and
   per-day supplements would flood the series. Cost: Fortnox shows a
   correction on the day it was found.
2. **Drafts are computed, only sent vouchers are stored.** No nightly job and
   no stale drafts. Cost: the Att bokföra list is a query over the log rather
   than a table.
3. **A bookkeeper presses the button.** Fully automatic posting would need the
   service connection to write, which breaks the token rule. If you want it
   hands-off later, that rule is the thing to revisit.
4. **Café purchases stay expensed**, and the app books the move into stock at
   delivery. The alternative is booking café purchases to the stock account
   like alcohol, which is tidier in Fortnox but means splitting every café
   receipt between stocked drinks and everything else at kontering.
5. **Events get an optional cost centre.** Without it all bar consumption
   lands on one cost centre.
6. **A member edits their own withdrawal the same day only.** After that the
   treasurer does.
7. **A departing member is invoiced at year end with everybody else**, with
   "Fakturera nu" for when you would rather not wait. Roles only refresh at
   sign-in, so "has left" can lag for somebody who never logs in again.
8. **Fortnox customers are created by the app.** This departs from the
   supplier rule (registers are kept in Fortnox only). A member is a person
   the app already knows, and ten customers a year by hand is the kind of
   work this replaces. Say if you would rather keep the rule.
9. **Two rail groups, one per stock**, rather than one Lager group with a
   stock switch.

Todo, filled in later in Inställningar. None of these blocks building,
because each is a setting that is null until chosen, and a stock exports
nothing until its own are complete. The settings page shows what is missing
per stock.

- [ ] Stock account and cost account per product type (five in alcohol, one
      in the café), and the optional spoilage and stocktake accounts.
      Inställningar -> Lager.
- [ ] Per stock: the cost centres, and for the café the purchase account to
      credit back, the board cost account and the board revenue account.
      Inställningar -> Lager.
- [ ] The voucher series for each stock (empty means the default series).
      Inställningar -> Lager.
- [ ] The day posting starts, per stock, and the opening voucher that goes
      with it. Inställningar -> Lager.
- [ ] Which Authentik groups are café leads, café workers and the board.
      Inställningar -> Roller, where `GroupRole` is already edited. The
      migration seeds no groups for the new roles.
- [ ] Which roles may log a refill (`CAFE_STOCK_REFILL`). Inställningar ->
      Roller.
- [ ] Board prices per product. Styrelsekonto -> Priser.

Todo, not a setting:

- [ ] The café's Sheets and the board's Excel, for the import. The import
      steps assume one row per delivery or refill with a date, product and
      quantity. The import script is written once the files are seen, and
      the café stock can start from a physical count without it.

No design question is open. One thing to check when the invoice export is
built: that the Fortnox licence includes fakturering and that the `invoice`
and `customer` scopes are granted on the next login.

## 10. Build order

1. `Stock`, the migration, routes and nav moved under `/stock/alcohol`. No
   behaviour change.
2. Café stock: products, delivery, stocktake, Påfyllning, the import.
3. Posting: classes, the Lagervärde pages, export, reconciliation, opening.
4. The board's tab: prices, withdrawals, the member's page.
5. `CustomerInvoice` and the year-end run.
6. Bokslut checks and the Översikt rows.

## 11. Places (2026-11-16)

The café's storage room is called Mauer. It is the `null` end of a move, not a place, and the pickers show it under that name.

Built 2026-11-16, uncommitted in main. Asked for by the café: Sexmästeriet
may take sodas while they work, and those belong on Sexet's budget. The two
fridges are charged to different budgets. What Sexet does not use comes back,
to storage or to any other place.

Decided with the user:

- Filling a fridge still counts as the drinks being used. Nobody counts what
  is inside a fridge. What changes is that each movement out of storage names
  where it went, and that place's cost centre is charged.
- Places are a fixed list per stock in Inställningar -> Lager, each with a
  cost centre. A place without one falls back to the stock's consumption cost
  centre.
- Only the café uses places. The model is per stock and switched on by the
  `usesPlaces` trait in `lib/stock/stocks.ts`, so the alcohol stock could turn
  it on later. Alcohol nights stay `StockEvent`s: a night is dated and
  one-off, a place is standing. What the two share is how the posting finds
  the cost centre (the night's, else the place's, else the stock's).
- Who may log is set per place by Authentik group, not by role. A sexmästare
  is only `ORDINARIE` in this app, so a role would have given the right to
  every member.
- A place may not return more of a product than it has taken, net, in the
  räkenskapsår of the move's date.
- Someone may log a move when they hold the place at either end. Storage is
  held by nobody. So a café worker in Kyl 1's group may refill Kyl 1, Sexet
  may take from storage and bring back to anywhere, and someone in two
  places' groups may move straight between them. Whoever keeps the stock
  (`CAFE_STOCK_MANAGE`) may log any move.

### Model

- `StockPlace`: `stockId`, `name` (unique per stock), `costCenterId`,
  `archived`, `sortOrder`. Archived rather than deleted, so the log keeps its
  names. An archived place grants nothing and is offered nowhere.
- `StockPlaceGroup { group, placeId }`: an Authentik group and a place, like
  `GroupResultUnit`. Read into `User.stockPlaceIds` at sign-in, in
  `lib/server/authentik-roles.ts` with roles and result units, and derived
  again for everyone when a place's groups or archived flag change
  (`reapplyGrants`).
- `StockEntry.placeId`: the place an `ISSUE` went to or a `RETURN` came back
  from. A database check keeps it apart from `eventId`. Refills logged before
  places have none and are charged to the stock's consumption cost centre.

### Movements

No new entry kinds. A move writes, per product, in one batch:

| From | To | Rows |
|---|---|---|
| storage | place | `ISSUE` to the place |
| place | storage | `RETURN` from the place |
| place | place | `RETURN` from the first, then `ISSUE` to the second |

Both are valued at the moving average, as every other removal and return is.
A move between places leaves storage and the stock account where they were,
credits the first place's cost centre and charges the second's. The posting
query takes the cost centre of an event or a place on `CONSUMPTION` rows, so
the daily voucher splits by place without any other change.

Undoing a move removes the whole batch. It is refused if storage would go
below zero, or if a place has since returned what the move gave it.

### Pages and API

- **Flytta varor** (`/stock/cafe/move`, replaces Påfyllning). Från and Till at the
  top, storage or a place, offering only moves the reader may log. From a
  place the list shows only what it has to give back, with how much. The
  route is kept after saving.
- **History**: a Plats column and a place filter (`?place=`), shared with
  Statistik when switching views.
- **Statistik** (History's other view, a page tab beside Rörelser): laid out
  like Utfall & rapporter, with the filters in a panel on the left (sticky on
  desktop, stacked on a phone) and the figures beside it. The period is the
  same picker as Utfall's (components/report-panel.tsx, lib/ui/period.ts):
  the whole räkenskapsår, one of its months, or dates of one's own, opening
  on the header's year. Then a Plats filter beside type and tag,
  and a "Per plats" card with each place's net for the period (a row narrows
  the page to it). Narrowed to places, the period card shows Tagit,
  Tillbaka and Netto, and the product list ranks what those places took, in
  units and value. The shelf-value chart and Fördelning nu stay the shelf's,
  since a place holds nothing. This replaced a "Platser i år" card at the
  foot of the stock page (2026-11-18), which sat under every product.
- **Inställningar -> Lager -> Platser**: add, rename, cost centre, groups
  (picked from the groups members hold, or typed), archive and restore. A
  place nothing has moved to or from can be deleted outright. One in the log
  can only be archived, since the history and sent vouchers name it.
- `POST /api/stock/moves` `{ stock, from, to, batchId, occurredAt, lines }`,
  `from` and `to` a place id or null for storage. `DELETE
  /api/stock/moves/[batchId]` undoes, its author the same day or the keeper.
- `POST /api/stock/places`, `PATCH` and `DELETE /api/stock/places/[id]`:
  settings only. `DELETE` is refused for a place with movements.

### Not built

- [ ] Roller lists a group that only grants a place as held but undecided.
      It could show the place it grants.
- [ ] Changes to places are not in the settings audit (`StockSettingsChange`).
- [ ] A coach-mark step for Flytta.
