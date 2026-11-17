# Settings: how Inställningar is laid out

Inställningar is one overlay over the app (`app/(app)/@modal/(.)admin`), with
the sections down the left and the open section to the right. Every settings
page follows the rules here, the way every app page follows
[navigation.md](navigation.md). A reader who has used one settings page
should know where everything is on the next.

## The sections

The sidebar groups the sections under four headings, in this order
(`components/shell/settings-sections.ts`):

```
Bokföring    Fortnox, Kostnadsställen, Resultatenheter
Utlägg       Bokföring & milersättning, Sektionskort
Verksamhet   Försäljning, Lager
Åtkomst      Användare, Roller & behörigheter
System       E-post
```

- On a laptop the overlay opens on the first section. On a phone it opens on
  the list of sections, under the same headings.
- Somebody holding GRANT_ACCESS without SETTINGS sees only Användare.
- A new section goes under the heading it belongs to. A fifth heading needs a
  reason the four cannot hold.

## No modal inside settings

The overlay is already a modal, so nothing in it opens another one.

- A record opens as its own page in the overlay, with its own URL:
  `/admin/users/[id]`, `/admin/result-units/[id]`, `/admin/email/[id]`. The
  overlay's bar shows a back arrow and the record's name. The back arrow, and
  the browser's Back, return to where the reader came from (the list, or the
  person whose mail it was).
- Deleting the record, and any other action on the whole record, is in a ⋯
  menu right after its name in the overlay's bar (`PageShell menu`). Radera is
  red there and still asks first. A row in a list keeps its own button at the
  row's end.
- Work on many rows at once that needs its own screen is a page too
  (`/admin/cost-centers/short-names`).
- A confirm dialog is the one exception: it asks a question and closes.
- The sidebar marks the section a record belongs to as current.

Each page under `app/(app)/admin` has a one-line re-export under
`app/(app)/@modal/(.)admin` so it opens in the overlay.

## One page anatomy

A settings page is a stack of cards (`components/settings/settings-card.tsx`).

- `SettingsCard` is about one thing. It has a title, and at the far end of the
  title line either one action (a button) or a status. Then rows, groups of
  rows, or a table. A card around a table needs no title: the page's title
  names it.
- `SettingRow` is one setting: what it is on the left, the control on the
  right, and under the control on a phone. A row may have a hint line about
  the field itself, the way a form field has one. `wide` gives a control that
  holds a list (chips, a multi-picker) the row's full width.
- `SettingsGroup` puts rows that belong together under a small heading on a
  tint, inside a card (the registers and years on Fortnox, the areas of a
  role).
- `SettingsSection` is for a page with several subjects (each stock on Lager):
  a heading over that subject's own cards, with its status at the end.
  `SetupStatus` says how much of a section's setup is left.
- Nothing explains a card under its title, and an explanation is not moved
  into an ⓘ hint either. What a card is for is its title's job. The ⓘ hints
  on the capabilities in Roller stay: each names what one tickbox does.
- No page sets its own width. Every page fills the overlay, so tables and the role list get the room the overlay has.

## Saving

Settings follow the usual convention: values wait for Spara, actions on a list
happen at once (`components/settings/settings-draft.tsx`).

- Every value a page edits (a picker, a text field, a tickbox, a set of groups
  or roles, a name edited in place) is a draft until the Spara at the bottom
  of the page. The bar has a fixed height and is always at the foot of the
  overlay, on a short page as on a long one. Spara and Ångra
  ändringar are only live while something has changed.
- Adding or deleting a row (a card, a cost centre, a result unit, a stock
  place, a product type, a personal grant), archiving, connecting Fortnox or
  Gmail, syncing and sending a test mail happen at once, with a confirm where
  they can do damage. They do not touch the draft: what was typed stays.
- Leaving with unsaved changes asks first: a link inside the app, closing the
  overlay (its X, Escape or the backdrop), and closing or reloading the tab.
  The browser's Back button is not caught.
- A page that only lists and acts (Användare, a member's page, E-post,
  Milersättning, the Resultatenheter list) has no values and so no bar.
- Each part of a page that holds a draft (`useDraft` for one record,
  `useDraftRows` for a field per row) registers with `useDraftPart`. One Spara
  sends every part's changes to the routes that already exist.

## Required settings

A setting something cannot work without is marked the way the app's forms
mark a required field: a star on its name (`SettingRow required`, or `Field
requirement="required"`). While it is empty, the line under it says what it
holds up ("Behövs innan lagret kan bokföras") in place of the hint.

- There is no list at the top of a page of what is left to set. The fields
  say it where they are, and a section's `SetupStatus` says how many are left.
- Saving is not refused for an empty required setting. Setup goes in steps.

## A thing is edited where it lives

Each setting has one home: the page of the thing it is about. Other pages may
show it, and link to its home.

- A result unit's cost centres and who answers for it (the Authentik groups
  that make somebody resultatansvarig) are edited on the unit's page.
- Its sales are set up on Försäljning, which is laid out unit by unit. The
  unit's page shows a summary and links there.
- A stock place's groups are edited on the place, on Lager.
- Roller & behörigheter holds what is about roles only: which group gives which
  role, and what each role may do.
- A member's personal grants are edited on their page under Användare.
- Fortnox holds the connection and the syncing, nothing else. What is booked
  how lives with what is booked: utlägg's accounts on the Utlägg page,
  takings' on Försäljning, a stock's on Lager.
- Every kind of export chooses its own verifikationsserie on its own page
  (utlägg, takings, each stock), and each is required. There is no shared
  default series to fall back on: an export whose series is not chosen is
  refused, with a link to the page where it is chosen.

## Settings follow navigation.md

- Two different tables on one page are two sections of the page, never a view
  toggle. A view toggle draws the same data two ways.
- Table tabs, filters and search work as on any list.
