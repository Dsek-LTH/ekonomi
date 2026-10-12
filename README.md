# utlagg

Expense and budget management for the section. A member uploads a receipt, the
expense is approved by the right result-unit owner, booked as a voucher and
exported to Fortnox. The same app holds the section's budget and measures it
against the actual outcome in the general ledger.

**Next.js (App Router) – TypeScript – Prisma/Postgres – MinIO (S3) – Auth.js –
Tailwind – next-intl**

---

## Screenshots

<!--
  Drop PNGs into docs/screenshots/ with the names below, then delete this
  comment wrapper so the images render.

| | |
| --- | --- |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Expense](docs/screenshots/expense.png) |
| **Dashboard**, what needs your attention | **An expense**: receipt, details, history |
| ![Approvals](docs/screenshots/approvals.png) | ![Budget](docs/screenshots/budget.png) |
| **Approvals**, the queue you answer for | **Budget**, the grid with formulas |
-->

_Screenshots pending. See the comment in this section for where to put them._

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Running the whole stack in Docker](#running-the-whole-stack-in-docker)
- [Signing in](#signing-in)
- [Troubleshooting](#troubleshooting)
- [Commands](#commands)
- [Project structure](#project-structure)
- [Three things to know before changing anything](#three-things-to-know-before-changing-anything)
- [Environment variables](#environment-variables)
- [Optional integrations](#optional-integrations)
- [Tests](#tests)
- [Working with section data](#working-with-section-data)
- [Production](#production)
- [Licence](#licence)

---

## Prerequisites

Install these before you start. The versions matter, because Next 16 and Prisma 7 both
refuse to run on older Node.

| Tool | Version | Check with | Notes |
| --- | --- | --- | --- |
| **Node.js** | 20.9 or newer | `node -v` | `.nvmrc` selects 22, which is what the production image runs; `nvm use` in the repo picks it up. 20.9 is the floor `engines` enforces, not what anyone tests on. |
| **pnpm** | 10.x | `pnpm -v` | The repo pins its own version. `corepack enable` (ships with Node) picks it up automatically, so don't install pnpm globally. |
| **Docker** | any recent | `docker compose version` | Runs Postgres and MinIO. Docker Desktop or Docker Engine both work; on Windows use WSL 2 and enable WSL integration in Docker Desktop. |
| **Git** | any | `git --version` | |

You do **not** need a local Postgres, a MinIO install, Authentik credentials
or a Fortnox account to develop. Everything below runs offline. Nor a
typesetter: the utläggsräkning is rendered by a Typst build that arrives with
`pnpm install`, so a fresh checkout renders it on the first run.

---

## Getting started

Six steps from a fresh clone to a running app. Run them in order, because each one
depends on the previous.

### 1. Clone and install dependencies

```bash
git clone <repo-url> utlagg
cd utlagg
corepack enable      # makes `pnpm` resolve to the version this repo pins
pnpm install
```

`pnpm install` only installs packages. It does not touch the database, and the
app will not start yet.

### 2. Create your `.env`

```bash
cp .env.example .env
```

The template's default values already match `docker-compose.yml`, so **it works
as-is locally**, and you don't have to fill anything in.

This step is not optional even though the app has fallbacks: the Prisma CLI
loads `.env` explicitly (see `prisma.config.ts`) and errors out if the file is
missing.

### 3. Start Postgres and MinIO

```bash
pnpm db:up           # docker compose up -d
```

This starts two containers in the background:

- **`utlagg-postgres`** on port `5432`, the database.
- **`utlagg-minio`** on ports `9000` (S3 API) and `9001` (web console), object
  storage for receipt files. Receipt images are never stored in Postgres.

Two, and only these two. The income service (intakt) is behind its own compose
profile because it builds from a separate repository, so a fresh clone starts
without it and the income pages report it unavailable. See [Optional
integrations](#optional-integrations) if you need them.

Both keep their data in Docker volumes, so they survive a restart. Check they
came up with `docker compose ps`; Postgres has a healthcheck and takes a few
seconds on first boot.

Stop them again with `pnpm db:down` when you're done for the day.

### 4. Generate the Prisma client

```bash
pnpm db:generate
```

Prisma generates a typed client from `prisma/schema/` into
`src/lib/generated/prisma`. The schema is a folder, not a file: every `.prisma`
in it is read as one schema, split by domain so a model is findable by the
thing it belongs to. That output directory is **gitignored**, so a fresh clone
has no client at all and TypeScript will report missing modules until you run
this. Re-run it every time the schema changes.

### 5. Create the schema and seed data

```bash
pnpm db:migrate      # applies prisma/migrations to your empty database
pnpm db:seed         # test data: users, committees, cost centres, expenses
```

`db:seed` **wipes and rewrites** the tables it owns. It's meant for a
development database, never a real one. Run it as often as you like to get back
to a known state; `pnpm db:reset` does the harder version (drop, re-migrate,
re-seed).

### 6. Run the app

```bash
pnpm dev
```

| What | Where | Credentials |
| --- | --- | --- |
| The app | http://localhost:3000 | see below |
| MinIO console | http://localhost:9001 | `utlagg` / `utlagg-dev-secret` |

The receipts bucket is created on the first upload, so you don't need to make it
by hand.

---

## Running the whole stack in Docker

Everything above runs the app on your machine and only the infrastructure in
Docker, which is the shorter loop: `pnpm dev` reloads, a container rebuild does
not. The stack below is for the other question: *does the thing we deploy
work?* It builds the same image the k8s cluster runs, and runs it the same way.

```bash
pnpm app:up      # build the image, migrate, start the stack → :3000
pnpm app:logs    # follow the app container
pnpm app:down    # stop it (Postgres and MinIO keep their data)
```

`pnpm db:up` is unaffected: the app and its migration step sit behind a compose
profile, so the everyday command still starts Postgres and MinIO alone.

**It will not start until `AUTH_AUTHENTIK_CLIENT_SECRET` is set.** The
container runs the production build, which requires every variable in
`.env.example` to have a value, and that is the one the template leaves empty,
since the development client it ships is a public one with no secret. Inside
the container the dev sign-in does not exist (`src/auth.ts` registers it only
when `NODE_ENV !== "production"`), so Authentik is the only way in. The check
tests presence, not validity: a placeholder gets the stack up and the login
page rendered, an application registered in Authentik gets you through it.
Whatever is missing is named in `pnpm app:logs` just before the container
exits.

Two things worth knowing:

- **Migrations run before the app does.** A `migrate` service runs
  `prisma migrate deploy` and the app waits for it to succeed, so a stack that
  is up is one whose schema matches its code. Seeding is intentionally not
  available in the production migration image: it wipes domain tables and must
  only be run through the local development workflow.
- **The image carries no configuration.** `.env` is in `.dockerignore`;
  compose passes the environment in at run time, as k8s will. The only values
  compose sets itself are `DATABASE_URL` and `S3_ENDPOINT`, because `localhost`
  inside a container is the container.

---

## Signing in

Sign-in goes through the guild's **Authentik** (`auth.dsek.se`), the same
identity provider the guild's own web app uses. Google is federated behind it,
so this app never holds a Google client of its own, and a mandate granted or
revoked in Authentik is granted or revoked here.

`.env.example` ships with the guild's public development client, which
Authentik only accepts localhost redirects for. That is enough to sign in with
your real D-sektionen account while developing. A deployment registers its own
application (redirect URI `<origin>/api/auth/callback/authentik`) and sets
`AUTH_AUTHENTIK_CLIENT_ID`, `AUTH_AUTHENTIK_CLIENT_SECRET` and
`AUTH_AUTHENTIK_ISSUER`; the server refuses to boot in production without them.

### Roles come from Authentik

A user's roles are derived from their Authentik group list on every sign-in and
on every token refresh. `dsek.skattm.mastare` is the skattmästare,
`dsek.ordf` the ordförande, and a committee's `…mastare`/`…ordf` is a
resultatansvarig. The mapping is one table in
`src/lib/server/authentik-roles.ts`, and it is the only place to change how a
group is read.

That makes Inställningar → Användare a read-only view: roles are changed by
changing the mandate in Authentik, not here. *Which* result units a
resultatansvarig answers for is still an explicit link in the app
(`ResultUnitOwner`), because a committee and a cost-centre prefix do not
correspond one to one.

### Without Authentik

Outside production the login page also offers a **dev login**: pick a seeded
user, no password, no network. Users are keyed on student id (Authentik's
`preferred_username`), so that is what it signs in with.

| Student id | Name | Role | Sees |
| --- | --- | --- | --- |
| `el1234li-s` | Elsa Lindqvist | Ordinarie | Their own expenses only |
| `os5678be-s` | Oskar Berg | Resultatansvarig | The approval queue for their result unit |
| `lu9012ge-s` | Ludwig Gehlsdorf | Skattförman | Bookkeeping and the ledger |
| `ma3456ho-s` | Maja Holm | Skattmästare | Everything, including Inställningar |

The four are buttons on the login page, so nothing needs typing.
`prisma/seed-data.ts` has the full list; everyone else in the fixtures gets a
derived student id. The dev provider is registered only outside production.
See `src/auth.ts`.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Cannot connect to the Docker daemon` | Docker isn't running | Start Docker Desktop. On Windows, also enable WSL integration for your distro in Docker Desktop → Settings → Resources. |
| `Bind for 0.0.0.0:5432 failed: port is already allocated` | You have another Postgres running | Stop it (`sudo systemctl stop postgresql`), or change the host port in `docker-compose.yml` and `DATABASE_URL` to match. |
| `Port 3000 is in use` | Something else has the port | `pnpm dev --port 3001` |
| `ENOENT: no such file or directory, '.env'` | Step 2 was skipped | `cp .env.example .env` |
| `P1001: Can't reach database server at localhost:5432` | Containers not up, or Postgres still starting | `docker compose ps`, then wait for the healthcheck and retry. |
| `Cannot find module '@/lib/generated/prisma'`, or hundreds of type errors after cloning | The Prisma client hasn't been generated | `pnpm db:generate` |
| `P3005: The database schema is not empty`, or migration drift | Your local database has diverged | `pnpm db:reset`, which destroys local data and rebuilds from migrations plus seed. |
| Receipt upload fails with an S3 or connection error | MinIO isn't running | `pnpm db:up`, then check http://localhost:9001 responds. |
| Dev login says the user doesn't exist | The seed hasn't run | `pnpm db:seed`. The four buttons on the login page match the seeded student ids. |
| The Fortnox pages say the integration isn't configured | Expected, because `FORTNOX_*` is unset | Nothing to fix; see [Optional integrations](#optional-integrations). |
| A production server refuses to boot, complaining about the environment | Deliberate: a required variable has no value | Set the ones it names; the check lives in `instrumentation.ts`. |
| `pnpm app:up` starts and the app container restarts forever | The same check, in Docker | `pnpm app:logs` names every variable that is wrong. See [Running the whole stack in Docker](#running-the-whole-stack-in-docker). |
| `pnpm app:up` starts and the app container restarts forever | The startup check, in Docker, almost always `AUTH_AUTHENTIK_CLIENT_SECRET` | `pnpm app:logs` names it. See [Running the whole stack in Docker](#running-the-whole-stack-in-docker). |
| Receipt upload fails in the Docker stack with `SignatureDoesNotMatch` | `S3_ACCESS_KEY`/`S3_SECRET_KEY` changed after MinIO's volume was created with the old ones | `docker compose down && pnpm app:up`. Compose passes the same two values to MinIO as its root credentials. |

---

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm dev:phone` | Development server reachable from a phone on the same network |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:watch` | Tests in watch mode |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:up` / `db:down` | Postgres + MinIO containers |
| `pnpm app:up` / `app:down` / `app:logs` | The whole stack in Docker, app included |
| `pnpm intakt:up` / `intakt:down` | The income service, which needs the sibling clone |
| `pnpm intakt:build` | Rebuild the intakt container after changing its Go source |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:migrate` / `db:reset` | Migrations |
| `pnpm db:seed` | Seed data |
| `pnpm db:studio` | Prisma Studio, to browse the database |
| `pnpm db:parse-budget` / `db:import-budget` | Read the budget spreadsheet into JSON, then import it |
| `pnpm budget:to-csv` | Convert a budget workbook to CSV for the paste-in importer |
| `pnpm db:import-income-config` | Load the income routing config (committees, revenue accounts) |
| `pnpm fortnox:sync` | Sync the chart of accounts, cost centres and general ledger |
| `pnpm receipts:gc` | Delete stored receipt files nothing points at |
| `pnpm stock:revalue` | Replay the stock ledger and rewrite the valuations |

---

## Project structure

All application source lives under `src/`; the root is configuration, the
database, and the things you run by hand.

```
src/app/(app)/    Signed-in views. Each route loads its own data in a Server
                  Component and hands it to a *-client.tsx.
src/app/api/      REST endpoints, 96 of them. Every handler starts with
                  gate(). See below.
src/components/   Shared components. components/ui/ holds the primitives
                  (DataTable, Field, Button …); components/columns/ the column
                  definitions the list screens share; components/shell/ the
                  frame around every page; components/receipt/ the viewer and
                  its panel; components/stock/ the stock-specific pieces. The
                  eight files directly under components/ are the ones that are
                  none of those: a page layout, the confirm dialog, the
                  allocation editor.
src/lib/domain/   Pure rules and shapes: money, status, permissions,
                  matching, the bank file. No side effects, runnable anywhere,
                  and what the tests cover.
src/lib/server/   Everything that touches the outside world: the database, the
                  environment, storage, secrets, the session. All `server-only`.
src/lib/data/     Reads the database and returns the shapes the screens use.
                  The only place the schema meets the interface. Also the
                  list-query pair. list-query.ts is what a filtered list *is*
                  (and how it is spelled in a URL), use-list-query.tsx the React
                  state around it. That is not database code, but it is the same
                  subsystem, and keeping the two halves apart is what let them
                  disagree about which tab a page had opened on.
src/lib/api/      What every route handler starts with: gate(), fail(), access.
src/lib/budget/   The budget engine: formula expressions, grid, comparisons, lock.
src/lib/ledger/   The general ledger: BAS structure, reports, comparison.
src/lib/fortnox/  Fortnox API, SIE parsing and sync.
src/lib/expense/  The utlägg document: the Typst cover sheet and the merge.
src/lib/contract/ Avtal: the archive's rules (tags, derived status, which files
                  are evidence) and the uthyrningsavtal the app draws, template
                  and villkor included.
src/lib/income/   Intäkter: product groups and the report shapes.
src/lib/stock/    Alkohollager: the entry replay and valuation.
src/lib/mileage/  Milersättning: rates and the distance calculation.
src/lib/ui/       Presentation helpers (formatting, class names, focus, routes).
src/lib/s3-config.ts
                  The one file directly under lib/, and the exception that
                  proves the rule below: bucket settings shared between the
                  app's `server-only` storage module and the standalone
                  scripts, which cannot import one.
src/i18n/         Locale resolution for next-intl, and the test that holds the
                  two message files to each other and to the call sites.
src/auth.ts       NextAuth, wired to Authentik.
src/types/        Ambient declarations (the NextAuth session shape).
prisma/           The database and nothing else: schema/ (one file per domain,
                  read as a single schema), migrations/, and the seed.
scripts/          Things you run by hand rather than things the app imports:
                  the Fortnox sync, the receipt sweeper, the stock revaluation,
                  the storage admin client, and import/ for the budget.
docker/migrator/  The migration image's own manifest. Deliberately npm and
                  deliberately tiny; see the Dockerfile for why.
messages/         Translations (sv is the source language, en the translation).
public/           Static files.
Dockerfile        The production image, and the migration step that precedes it.
docker-compose.yml
                  Postgres and MinIO by default; the app and the income service
                  behind the `app` and `intakt` profiles.
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers the conventions that go with this
layout: the writing style, the boundary rules, and what to run before pushing.

The split inside `lib/` follows what the code *touches*, not what it's *about*:
everything in `domain/` is pure functions that neither read the database nor
know about a request, and everything in `server/` does the opposite. The
boundary is worth keeping. It's what makes the domain logic testable without
Postgres, and `lib/domain/boundary.test.ts` fails if someone reaches across it.

The line between `prisma/` and `scripts/` is the same kind of rule: `prisma/`
holds the database's own definition, and anything that is a program you invoke
lives in `scripts/`, even when the first thing it does is open a connection.

---

## Three things to know before changing anything

**Permissions are derived, never hardcoded.** Who may view, approve and edit is
decided by `lib/domain/permissions.ts`, and every API route starts with `gate()`
from `lib/api/guard.ts`, which reads roles from the database, not from the
session, because a role that's removed must stop applying immediately. Budget
writes additionally go through `lib/budget/access.ts`, which handles the lock.

**Every control has to work without a mouse.** A row that opens something is a
link, not a click handler on the `<tr>`; a sortable column is a button in the
header, and the header carries `aria-sort`; a dialog traps Tab and gives focus
back when it closes. `eslint-plugin-jsx-a11y` runs as warnings and is currently
clean, and it is there to catch the next clickable `<div>`, not to be silenced.

**Money is stored in öre.** The database holds integer öre and so does every
amount in an API request body; only the interface counts in kronor, and it
converts on the way out. `lib/domain/money.ts` is the only place that converts,
so never write `* 100` by hand. The reason this is stated so firmly: a PATCH body
once carried the gross in öre and each cost-centre row in kronor, which made a
distribution that had to sum to the gross a hundred times too small.

---

## Environment variables

`.env.example` lists all of them and `lib/server/env.ts` is the code that reads
them. Locally, empty values work: the fallbacks match `docker-compose.yml`. In
production there are no fallbacks, and the server refuses to start if anything is
missing (`instrumentation.ts`). It checks that a value is there, not that it is
a good one: `AUTH_SECRET` and `S3_SECRET_KEY` still have to be generated by
whoever deploys.

---

## Optional integrations

Not needed for local development, and it does not fail loudly when absent. The
app tells you it's switched off.

**Fortnox** (`FORTNOX_CLIENT_ID`, `FORTNOX_CLIENT_SECRET`,
`FORTNOX_REDIRECT_URI`) drives the bookkeeping export and the ledger sync. With
the variables unset both stay off. Once configured, connect the account from
the Fortnox settings page; the OAuth tokens are stored encrypted with
`FORTNOX_TOKEN_KEY` (falling back to `AUTH_SECRET`, which means rotating
`AUTH_SECRET` forces a reconnect, so set it separately to decouple the two).

**intakt** (`INTAKT_URL`, `INTAKT_TOKEN`) reads Zettle and Swish exports and
renders the intäktsräkningar. It is a separate service in a separate
repository, a Go program that renders its PDFs with pdflatex, which is the
reason it is not part of this image: a TeX installation has no business inside
the container that serves every page of the app.

It is the one thing here a clone of this repository cannot build on its own.
Clone it beside the app first, into `./intakt`, which is gitignored:

```bash
git clone git@github.com:LudwigGehlsdorf/intakt.git intakt
pnpm intakt:up
```

Then set `INTAKT_URL=http://localhost:8080` and a matching `INTAKT_TOKEN` in
`.env`. Without it the income pages say the service is unavailable, the same
way the bookkeeping pages do without Fortnox, and everything else works.

`pnpm db:up` and `pnpm app:up` both leave it out. To run the full stack with
it:

```bash
docker compose --profile app --profile intakt up -d
```

---

## Tests

```bash
pnpm test
```

Runs the unit tests for the domain logic: money conversion, attest authority,
the submission lock, the budget formula engine and the bank-file parser.
Everything tested is pure functions over pure data, so the suite runs in under a
second with no database.

What touches Prisma (`lib/data/`, `lib/ledger/report.ts`) is deliberately not
tested here. That needs a real Postgres and is a different kind of test.

---

## Working with section data

Bank files and budget spreadsheets are working files, not source. They contain
real account numbers and purchases traceable to individual members, and they
belong in the section's own storage, not in a git history that every clone
carries forever. `*.csv`, `*.xls` and `*.xlsx` are therefore ignored.

A bank file was committed once and had to be scrubbed out afterwards, which
means rewriting history for everyone. Keep them next to the repo instead.

---

## Production

The app ships as the image `Dockerfile` builds: Next's standalone output on
`node:22-bookworm-slim`, running unprivileged, holding no configuration of its own and
nothing it needs to write to disk. It listens on `PORT` (3000 by default) and
exits non-zero on a misconfigured environment rather than serving 500s, so a
bad deploy fails instead of going green. `prisma migrate deploy` is a separate
step, the `migrator` stage of the same Dockerfile, and must run before a new
version starts. The runner image carries the same migrator under `/migrator`,
which is what the cluster runs, so one build yields both. [Running the whole stack in
Docker](#running-the-whole-stack-in-docker) is the same arrangement locally.

---

## Licence

MIT. See [LICENSE](LICENSE).

One exception, and it is not ours to relicense: the Inter font files under
`src/lib/expense/cover/fonts/`, which the expense cover sheet embeds, are under
the SIL Open Font License 1.1. Their licence sits beside them in that
directory.
