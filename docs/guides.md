# Guides: coach marks over the real app

A guide is a short tour of one page. Each step points at a real control on
the page and says what it is for. Nothing is mocked and nothing is drawn from
a screenshot, so a guide cannot drift from the UI it describes. It can only
point at something that has moved, and a test catches that (see Anchors).

## The guides

One per page, and one for Översikt that goes over the whole app.

| Id | Page | Covers |
|---|---|---|
| `start` | Översikt | Att göra, every section in the menu the reader can see, Inställningar, the räkenskapsår, Frågor & svar, theme and language |
| `expenses` | Utlägg | new utlägg, the stages, and each scope the reader has (Mina, Min resultatenhet, Alla) |
| `bank` | Bankhändelser | Att redovisa, each scope, importing statements |
| `inbox` | Inkorg | what a document is, the unit's part, Att sortera, Hos enheterna, uploading |
| `invoices` | Fakturor | the stages, each scope |
| `income` | Intäkter | fetching, reviewing and exporting, the stages |
| `budget` | Budget | opening a budget, comparing, making a new one |
| `ledger` | Utfall & rapporter | picking a report, table or chart, export |
| `stock` | Lager | the section's pages, Behöver ses över, registering |

Bokslut, Uthyrning, Avtal and Inställningar have no guide of their own.

## Who sees what

Each step is shown once to each reader. Its id (`expenses.scopeUnit`) is kept
on `User.seenGuideSteps`, so it is not lost with the browser's storage.

Most steps need no rule for who they are for. They point at a control, and
the app only draws a control for someone who may use it: the Min
resultatenhet switch for a resultatansvarig, the import button for whoever
imports. A step whose control is not on the page is not that reader's, and is
left out. The few steps that point at nothing (a card in the middle) can say
who they are for with `visible`.

That is also how new permissions are introduced. When a reader is given more,
the controls for it appear, and the steps pointing at them are unseen. Next
time they open the page, its guide runs with only those steps, headed "Nytt
för dig". Översikt does the same with sections that have newly appeared in
the menu.

## How it works

- A guide is data: `src/lib/domain/guides.ts` lists each one with its page
  and its steps. A step names a `target` and has its text under
  `guides.<id>.<step>` in `messages/`.
- A target is a `data-tour="name"` attribute on the element. The shared
  components name theirs from their value: `scope:unit` on the scope switch,
  `tab:attest` on a table's stage tab, `list-action` on a list's own button,
  `nav-group:groupStock` on the menu's rows. The same name may sit on a
  desktop and a phone version of one control, and the guide uses whichever is
  on screen.
- A guide decides what to show once the page has rendered (its PageShell
  carries `data-tour-page`, which a loading skeleton does not), not after a
  timeout.
- A guide stays on its page and never navigates. The reader leaving ends it,
  and what was not shown comes up again next time. The only thing a guide
  opens is a menu, to show what is in it (`opens`): the nav, or the account
  menu for theme and language. On a phone both are the one menu screen.
- The page is covered while a guide runs, so nothing on it can be pressed.

## Starting a guide

- A page's guide starts by itself the first time the reader opens the page
  with steps they have not seen, wherever they came from.
- The account menu (and the phone's menu) has "Guide för den här sidan" and
  "Rundtur i appen", which run a guide whole, seen steps included.

## Anchors

`guides.test.ts` checks that every `target` named in `guides.ts` is a
`data-tour` somewhere under `src/`. For a name built from a value
(`tab:ATTENTION`) it checks that the component names its anchors that way and
that the value is written somewhere. Renaming or removing an anchor without
the guide fails the test, rather than a step quietly vanishing.

## Rules for the text

- About seven steps a page. A longer explanation belongs in Frågor & svar.
- One idea per step, in the app's own words (kontera here, bokföra in Fortnox).
- The writing rules in `AGENTS.md` apply.
