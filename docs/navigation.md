# Navigation: where a state change lives

Every way of moving around the app answers exactly one question, sits in the
same place on every page and has its own URL parameter. A reader should be
able to guess where a control is before they look for it.

| Control | Question | Changes | Where |
|---|---|---|---|
| Sidebar entry | Which area? One kind of thing. | path | rail |
| Section tabs | Which page in this area? | path | band, top |
| Scope switch | Whose? Mina / Min resultatenhet / Alla | `?scope=` | band, right end |
| Table tabs | Which stage? Grouped by who acts next, ending in Alla. | `?tab=` | top of the table |
| Filters | Narrow by attribute: search, date, type, unit. | `?q=`, ... | table toolbar |
| View toggle | The same data drawn differently (table or chart). | `?view=` | page toolbar, never the band |
| Page tabs | Parts of one record (a bokslut year). | path | under the detail page's title |

Rules:

- A sidebar area is one kind of thing. There is no cross-object inbox. What
  waits on you across objects is on Översikt.
- Stage is always a table tab. Never a separate page, never the scope switch,
  never a filter.
- The scope switch only ever says whose rows. Mina is what you submitted, Min
  resultatenhet is what your result units answer for (and so what you attest),
  Alla is the section. Switching scope keeps the stage you were on
  (`useScopeSwitch`).
- A tab or scope that can never hold anything for the reader is hidden.
- A page opens on the scope the reader's work is on (Alla for bookkeeping, Min
  resultatenhet for an attester, otherwise Mina) and the stage that needs them
  there, or Alla when no stage does.
- All of it is in the URL, so a link or Back lands on the same view. A list cut
  in the browser keeps its tab there too (`useUrlTab`).
- A count, on a rail row or a table tab, always means "waiting on you".
- One-at-a-time work surfaces (`/expenses/review`, `/income/review`) are
  entered from a list's primary button. They are never tabs.
- A route that moves is not kept as a redirect. The old path simply goes.

## The tree

```
Översikt  /dashboard
  scope: Min resultatenhet | Sektionen (the personal view for members without a unit)
  "Väntar på dig": utlägg, levfakturor and card purchases together

Utlägg
  Utlägg  /expenses
    scope: Mina | Min resultatenhet | Alla
    tabs: Utkast | Att attestera | Att kontera | Att bokföra | Bokförda | Alla
      default: Mina -> Alla, Min resultatenhet -> Att attestera, Alla -> Att kontera
    /expenses/[id], /expenses/[id]/book
    /expenses/review  (Granska och bokför, bookkeepers on Alla)
  Bankhändelser  /bank
    scope: Mina | Min resultatenhet | Alla

Leverantörsfakturor
  Inkorg  /invoices/inbox  (triage only)
  Fakturor  /invoices
    scope: Min resultatenhet | Alla
    tabs: Att attestera | Att bokföra | I Fortnox | Alla
      default: Min resultatenhet -> Att attestera, Alla -> Att bokföra
    /invoices/[id]

Bokföring
  Intäkter  /income
    tabs: Att bokföra | Att exportera | Exporterade | Alla
    /income/review  (Granska och bokför)
  Bokslut  /closing
    page tabs: Checklista | Verifikationer | Konton
    /closing/template

Budget & utfall
  Budget  /budget
    /budget/[id]  view: Detalj | Ram
    /budget/compare
  Utfall & rapporter  /ledger  view: Tabell | Diagram

Lager
  Produkter  /stock
  Tillfällen  /stock/events
    /stock/events/[id]  page tabs
  Historik  /stock/history  view: Rörelser | Statistik

Uthyrning
  Uthyrningar  /rentals
  Utrustning  /rentals/equipment

Avtal
  Arkiv  /contracts
  Motparter  /contracts/counterparties

Frågor & svar  /faq
Inställningar  (overlay)
```

Utlägg tabs by status, in the app's own words (kontera here, bokföra in
Fortnox): Utkast is `DRAFT` and `CHANGES_REQUESTED` (the submitter acts next),
Att attestera is `PENDING_APPROVAL`, Att kontera is `APPROVED`, Att bokföra is
`BOOKED`, Bokförda is `EXPORTED`.

Min resultatenhet + Att attestera is answered by the attest authority query
(`attestScopeWhere`), not by a unit filter, so the reader's own utlägg and
partly attested splits come out right.

## Not yet following the model

- The stock list's "per datum" picker still stands in the band where the scope
  switch goes. It is a filter on time, so it belongs with the räkenskapsår below.
- Intäkter says "Att bokföra" for a day to book here, where Utlägg says "Att
  kontera" for the same step.

## The räkenskapsår

One of Fortnox's financial years, picked in the header (`AppHeader`), one level
above the scope switch. It is kept in a session cookie (`fiscal_year`), so it
stays put while somebody works and a new session opens on the year today falls
in. The server resolves it once per request (`getFiscalYear`), and every page
that cares asks for it there.

- It narrows every list with a date, on every tab, the work tabs included:
  picking 2025 is asking to see 2025. Utlägg by purchase date (the Granska
  queue too), Bankhändelser by transaction date ("Utan kort" too, which is only
  a tab while the year has one), Fakturor by the invoice's date or, without
  one, when it arrived, Intäkter by the day of the takings, and the Inkorg by
  when each document arrived.
- Översikt's queue, your own latest utlägg and the unaccounted card purchases
  are in the year too, and so are the counts beside the nav's links, so a
  count never promises rows the list it leads to then hides.
- It is the year of Översikt's budget figures, of the Budget list, of Utfall's
  report (which has no year field of its own any more) and of Bokslut
  (`/closing`, `/closing/vouchers`, `/closing/accounts`), which has no year in
  its path or list of years to pick from.
- On a page it does not narrow, the picker stands greyed out
  (`fiscalYearApplies`), so the header keeps its shape.
- No page has a year picker of its own, and nothing else uses the cookie.
