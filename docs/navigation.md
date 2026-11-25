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
| Page tabs | Parts of one record (a bokslut year), or two pages over the same data that answer different questions (Historik: Rörelser, Statistik). | path or `?view=` | under the page's title |

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
- There are no one-at-a-time work surfaces. An item is worked on its own
  page, opened row by row from its list, and every action there goes back to
  the list: an utlägg from `/expenses/[id]`, a levfaktura from
  `/invoices/[id]`, a day of income from `/income/zettle/[id]` or
  `/income/swish/[id]`. What is the same for many items at once (konterar
  every day that needs nobody) is a button on the list's toolbar.
- The back arrow means up. Every nested page names its parent
  (`PageShell back`): kontering and fördelning go up to the levfaktura, the
  levfaktura to its list. A finished step goes up the same way. Both use
  `useGoUp` (`components/shell/route-history.tsx`): back in history when the
  parent is the entry right behind, otherwise in place of the page, so nothing
  spent is left for the browser's Back to land in. Up is never "where you came
  from": a record opened from Översikt goes up to its list, and the browser's
  own Back still returns to Översikt. Closing the settings overlay is not going
  up and returns to the page it opened over (`useCloseOverlay`).
- Leaving never loses work, so a working page does not ask before you go. A
  booking screen (utlägg booking, levfaktura kontering) keeps what is typed as
  a draft on the computer (`useLocalDraft`) and brings it back with a
  "Börja om" button. Only settings ask, from the overlay (docs/settings.md).
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
  Bankhändelser  /bank
    scope: Mina | Min resultatenhet | Alla

Leverantörsfakturor
  Inkorg  /invoices/inbox  (triage and admins only) documents with no invoice yet.
    No tabs. Giving a document to a unit makes the invoice (ASSIGNED).
  Fakturor  /invoices
    scope: Min resultatenhet | Alla
    tabs: Att attestera | Att kontera | Att skicka | I Fortnox | Alla
      default: Min resultatenhet -> Att attestera, Alla -> Att kontera
    /invoices/[id]            the record, one layout in every state
    /invoices/[id]/allocate   Fördela (the unit's split and attest)
    /invoices/[id]/book       Kontera, which only saves. Skicka till Fortnox is on the record.

Intäkter
  Zettle  /income/zettle
  Swish   /income/swish
    tabs: Att kontera | Att bokföra | Bokförda | Alla
      default: Att kontera for whoever books, Alla for a reader
    toolbar: Hämta från Zettle / Ladda upp Swish-fil, Kontera N klara dagar,
             Granska och bokför N dagar
    /income/zettle/[id], /income/swish/[id]   the day: Kontera, then
             Granska och bokför by somebody else (the two-person rule)

Bokföring
  Bokslut  /closing
    page tabs: Checklista | Verifikationer | Konton
    /closing/template

Budget & utfall
  Budget  /budget
    /budget/[id]  view: Detalj | Ram
    /budget/compare
  Utfall & rapporter  /ledger  view: Tabell | Diagram

Alkohollager
  Produkter  /stock/alcohol
  Tillfällen  /stock/alcohol/events
    /stock/alcohol/events/[id]  page tabs
  Bokföring  /stock/alcohol/bookkeeping   (bookkeepers)
    tabs: Att bokföra | Bokförda. Avstämning above. "Bokför t.o.m. [datum]".
  Historik  /stock/alcohol/history  page tabs: Rörelser | Statistik (?view=stats)

Cafélager
  Produkter  /stock/cafe
  Flytta  /stock/cafe/move   (a phone in the storage room; anyone holding a place)
  Bokföring  /stock/cafe/bookkeeping   (bookkeepers, as for alcohol)
  Historik  /stock/cafe/history  page tabs: Rörelser | Statistik (?view=stats)

Styrelseborder
  Logga  /board   (board members, and the treasurer for anybody)
  Mina uttag  /board/history   the open tab as a receipt, earlier tabs below
  Fakturering  /board/invoices   (bookkeepers) one row per person
    /board/invoices/[memberId]  that person's tab
  Priser  /board/prices

Frågor & svar  /faq
Inställningar  (overlay, see settings.md)
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

## The redovisningsbetyg

A member's score from 0 to 100 for how well they do their part, as buyer and
as attester (lib/domain/member-score.ts).
It is a property of a person, not a kind of thing, so it has no page in the
nav. A member sees their own on Översikt and in full on the profile. The
holders of MEMBER_SCORE_VIEW also get a Medlemmar tab in the profile overlay
(`/profile/members`, every member's score with search), a "Släpar efter" card
on Översikt naming whoever has purchases waiting, and the submitter's score
beside their name on an utlägg. Every one of those opens the same breakdown.
It reads a rolling year, not the räkenskapsår.

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
  one, when it arrived, Intäkter (Zettle and Swish) by the day of the takings.
- The Inkorg is not narrowed. Its documents have no date until somebody reads
  one off them, and one uploaded while another year is picked must still be
  there to triage. The picker stays live on it all the same, since an invoice
  made from it is made in the picked year.
- Anything new is made in the picked year: an utlägg or milersättning, a
  verifikation, a levfaktura's date, an intäktsrapport, a Zettle or Swish
  fetch and a budget. A date outside it is refused on the form and by the
  route (`denyOutsideFiscalYear`), with a word to switch year in the header.
  A record already carrying a date from another year can still be saved, as
  long as the edit is not what sets it.
- Översikt's queue, your own latest utlägg and the unaccounted card purchases
  are in the year too, and so are the counts beside the nav's links, so a
  count never promises rows the list it leads to then hides.
- It is the year of Översikt's budget card, of the Budget list, of Utfall's
  report (which has no year field of its own any more) and of Bokslut
  (`/closing`, `/closing/vouchers`, `/closing/accounts`), which has no year in
  its path or list of years to pick from.
- On a page it does not narrow, the picker stands greyed out
  (`fiscalYearApplies`), so the header keeps its shape.
- No page has a year picker of its own, and nothing else uses the cookie.
