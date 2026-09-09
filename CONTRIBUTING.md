# Contributing

This is the section's expense system. It handles real money and real people's
reimbursements, so the bar for a change is that someone else can understand it
a year from now, when whoever wrote it has graduated.

Start with the [README](README.md) for setup. This file is the part that is not
setup: the conventions, and what to run before you push.

## Before you push

```bash
pnpm typecheck     # tsc --noEmit, and it covers scripts/ and prisma/ too
pnpm lint          # ESLint, including the a11y rules
pnpm test          # ~1000 unit tests, runs in about two seconds
```

All three are fast enough that there is no reason to skip one. There is no CI
running them for you.

## The conventions that are not obvious

**Read [AGENTS.md](AGENTS.md) for the writing style.** It applies to
everything: user-facing strings in `messages/`, comments, commit messages, and
schema notes. The short version is no em dashes and no middle dots, with the
exceptions listed there.

**Comments explain why, not what.** The code in this repo is unusually heavily
commented and that is deliberate. Nearly every comment records a decision or an
incident: why the budget engine computes in kronor while it stores öre, why the
a11y rules are warnings rather than errors, why the migrator image uses npm.
When you change something a comment describes, change the comment.

**`lib/domain/` is pure and `lib/server/` is not.** Anything in `domain/` is
plain functions over plain data: no database, no session, no filesystem. That is
what makes it testable without Postgres, and `lib/domain/boundary.test.ts` fails
if you break it. If a helper needs the database, it belongs in `server/` or
`data/`.

**Money is integer öre.** The database, every API request body, every domain
function. Only the interface counts in kronor. `lib/domain/money.ts` is the only
place that converts, so never write `* 100` by hand.

**Permissions are derived, never hardcoded.** Every API route starts with
`gate()` from `lib/api/guard.ts`, which reads roles from the database rather
than the session, because a role that is removed has to stop applying at once.

**Every control has to work without a mouse.** A row that opens something is a
link, not an `onClick` on the `<tr>`. A sortable column is a button, and the
header carries `aria-sort`.

## Adding a user-facing string

Both `messages/sv/<namespace>.json` and `messages/en/<namespace>.json`, always,
where `<namespace>` is the top-level key a page's strings live under (see
`MESSAGE_NAMESPACES` in `src/i18n/request.ts`). `sv` is the source language and
`en` is the translation. `src/i18n/messages.test.ts` fails if a key exists in
one file and not the other, or if nothing in `src/` calls it. Without that test
a missing key renders as `expenses.wizard.paymentType` in the middle of a
sentence, in production, for whoever is reading in the other language.

## Changing the database

The schema is a folder, `prisma/schema/`, split by domain. Add a model to the
file it belongs to.

```bash
pnpm db:migrate    # prisma migrate dev, creates the SQL and applies it
pnpm db:generate   # only needed if the client is stale
```

Commit the generated migration in `prisma/migrations/` with the schema change.
Never edit a migration that has been applied anywhere but your own machine.

## Commits

Present tense, describing the change and its reason. The repository history is
one of the few places the reasoning survives, so a message that says what broke
is worth more than one that says what file moved.
