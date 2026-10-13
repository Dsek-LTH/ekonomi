# ekonomi

Expense and budget management for D-sektionen. A member uploads a receipt, the
right result-unit owner approves it, and it is booked as a voucher and exported
to Fortnox. The app also holds the section's budget and compares it with the
outcome in the general ledger.

**Next.js 16 (App Router), TypeScript, Prisma 7 on Postgres, MinIO (S3),
Auth.js with Authentik, Tailwind, next-intl**

Conventions and what to run before pushing are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 22 (`.nvmrc`) | 20.9 is the minimum. Next 16 and Prisma 7 refuse older versions. |
| pnpm | pinned in `package.json` | Run `corepack enable` rather than installing pnpm globally. |
| Docker | any recent | Runs Postgres and MinIO. On Windows, use WSL 2. |

No Authentik credentials, Fortnox account or local Postgres are needed to
develop.

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env   # the defaults match docker-compose.yml
pnpm db:up             # Postgres on :5432, MinIO on :9000 (console :9001)
pnpm db:generate       # Prisma client into src/lib/generated (gitignored)
pnpm db:migrate        # apply migrations
pnpm db:seed           # test data. Wipes the tables it owns.
pnpm dev               # http://localhost:3000
```

`.env` is required even though the app has fallbacks, because the Prisma CLI
reads it explicitly (`prisma.config.ts`). Rerun `pnpm db:generate` whenever the
schema in `prisma/schema/` changes. `pnpm db:reset` drops, migrates and reseeds
from scratch.

The MinIO console login is `ekonomi` / `ekonomi-dev-secret`. The receipts bucket
is created on the first upload.

## Signing in

Sign-in goes through the guild's Authentik (`auth.dsek.se`). `.env.example`
ships the guild's public development client, which works for localhost, so you
can sign in with your real D-sektionen account.

A person's roles, and the result units they answer for, come from their
Authentik groups and are written at sign-in. Which group grants what is set
under Inställningar → Roller. The logic is in
`src/lib/server/authentik-roles.ts`.

Outside production the login page also has a **dev login** with the seeded
users:

| Student id | Role | Sees |
| --- | --- | --- |
| `el1234li-s` | Ordinarie | Their own expenses |
| `os5678be-s` | Resultatansvarig | The approval queue for their result unit |
| `lu9012ge-s` | Skattförman | Bookkeeping and the ledger |
| `ma3456ho-s` | Skattmästare | Everything, including Inställningar |

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server (`dev:phone` to reach it from a phone) |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm test` / `test:watch` | Unit tests (Vitest) |
| `pnpm typecheck` / `pnpm lint` | `tsc --noEmit` / ESLint |
| `pnpm db:up` / `db:down` | Postgres and MinIO |
| `pnpm app:up` / `app:down` / `app:logs` | The whole stack in Docker, app included |
| `pnpm intakt:up` / `intakt:down` / `intakt:build` | The income service (see below) |
| `pnpm db:generate` / `db:migrate` / `db:reset` / `db:seed` | Prisma client, migrations, seed |
| `pnpm db:studio` | Browse the database |
| `pnpm fortnox:sync` | Sync accounts, cost centres and the general ledger from Fortnox |
| `pnpm db:parse-budget` / `db:import-budget` / `budget:to-csv` | Budget spreadsheet import |
| `pnpm db:import-income-config` | Load the income routing config |
| `pnpm receipts:gc` | Delete stored receipt files nothing points at |
| `pnpm stock:revalue` | Replay the stock ledger and rewrite valuations |

## Project structure

```
src/app/(app)/   Signed-in pages. A Server Component loads data, a *-client.tsx renders it.
src/app/api/     REST endpoints. Every handler starts with gate() (src/lib/api/guard.ts).
src/components/  Shared components. ui/ holds the primitives.
src/lib/domain/  Pure rules: money, status, permissions. No I/O. Most tests live here.
src/lib/server/  Everything with side effects: database, env, storage, session, mail.
src/lib/data/    Database reads shaped for the screens.
src/lib/<area>/  budget, ledger, fortnox, expense, contract, income, stock, mileage.
src/auth.ts      Auth.js wired to Authentik.
prisma/          schema/ (one file per domain), migrations/, seed.
scripts/         Things run by hand: Fortnox sync, imports, maintenance.
messages/        Translations. sv is the source, en the translation.
docker/migrator/ The migration image's own small npm manifest.
```

## Environment variables

`.env.example` lists every variable with an explanation, and
`src/lib/server/env.ts` reads them. Locally, missing values fall back to
development defaults. In production there are no fallbacks: the server exits on
startup if a required variable is missing (`src/lib/server/startup.ts`). It
checks that values are set, not that they are good, so generate real
`AUTH_SECRET` and `S3_SECRET_KEY` values for a deployment.

### Optional integrations

Each of these is off when its variables are unset, and the app says so instead
of failing.

- **Fortnox** (`FORTNOX_*`): bookkeeping export and ledger sync. Connect the
  account from the Fortnox settings page.
- **intakt** (`INTAKT_URL`, `INTAKT_TOKEN`): income reports from Zettle and
  Swish. A separate Go service in its own repository:
  ```bash
  git clone git@github.com:Dsek-LTH/intakt.git intakt   # gitignored
  pnpm intakt:up                                         # serves :8080
  ```
- **Email** (`SMTP_*`, `MAIL_FROM`, `APP_URL`): without `SMTP_HOST`,
  notifications are written to the server log.
- **Scheduled jobs** (`CRON_SECRET`): `POST /api/cron/weekly-digest` and
  `/api/cron/deliver-mail`, called with `Authorization: Bearer <CRON_SECRET>`.
  Without the secret they answer 404.

## Running the whole stack in Docker

```bash
pnpm app:up     # build the production image, migrate, start on :3000
pnpm app:logs
pnpm app:down
```

This runs the same image production runs, with the same production rules.
There is no dev login inside the container, so you sign in through Authentik. A
`migrate` service runs `prisma migrate deploy` before the app starts. Compose
reads `.env` and overrides only `DATABASE_URL`, `S3_ENDPOINT` and `INTAKT_URL`.
If the app container keeps restarting, `pnpm app:logs` names the variable it
is missing.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `ENOENT ... '.env'` | `cp .env.example .env` |
| `P1001: Can't reach database server` | `pnpm db:up`, then wait for Postgres's healthcheck (`docker compose ps`). |
| `Cannot find module '@/lib/generated/prisma'` | `pnpm db:generate` |
| `P3005` or migration drift | `pnpm db:reset` (destroys local data) |
| Port 5432 already in use | Stop your other Postgres, or change the port in `docker-compose.yml` and `DATABASE_URL`. |
| Dev login says the user doesn't exist | `pnpm db:seed` |
| Receipt upload fails | MinIO isn't running: `pnpm db:up`. |
| `SignatureDoesNotMatch` in the Docker stack | The S3 keys changed after MinIO's volume was created: `docker compose down && pnpm app:up`. |

## Production

The `Dockerfile` builds Next's standalone output on `node:22-bookworm-slim`. The
container runs unprivileged and stores nothing on disk. It listens on `PORT`
(3000) and exits non-zero on a bad environment. Migrations must run before a
new version starts. The image carries the migrator under `/migrator`, run with
`node node_modules/prisma/build/index.js migrate deploy`, so one build gives
both. The image build skips the TypeScript check (`SKIP_TYPECHECK=1`), so run
`pnpm typecheck` before pushing.

## Licence

MIT. See [LICENSE](LICENSE).
