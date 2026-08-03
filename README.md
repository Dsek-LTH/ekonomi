# utlagg

Utläggs- och budgethantering för sektionen: en medlem laddar upp ett kvitto,
utlägget attesteras av rätt resultatansvarig, bokförs som en verifikation och
exporteras till Fortnox. Samma app håller sektionens budget och ställer den mot
utfallet i huvudboken.

Next.js (App Router) · TypeScript · Prisma/Postgres · MinIO (S3) · Auth.js ·
Tailwind · next-intl.

## Komma igång

Krav: Node 20+, pnpm, Docker (för Postgres och MinIO).

```bash
pnpm install            # kör även copy-pdf-worker
cp .env.example .env    # fungerar som den är lokalt
pnpm db:up              # Postgres + MinIO via docker compose
pnpm db:generate        # Prisma-klienten (genereras till src/lib/generated)
pnpm db:migrate         # kör migrationerna
pnpm db:seed            # testdata: användare, kommittéer, kostnadsställen
pnpm dev
```

Appen ligger på http://localhost:3000. MinIO-konsolen på http://localhost:9001
(`utlagg` / `utlagg-dev-secret`).

**Logga in lokalt.** Google-inloggning kräver riktiga credentials, så utanför
produktion finns en dev-inloggning: välj "Dev login" och ange e-postadressen
till en seedad användare (`@user.dsek.se`). Den provider registreras aldrig i
produktion — se `auth.ts`.

## Kommandon

| Kommando | Vad det gör |
| --- | --- |
| `pnpm dev` | Utvecklingsserver |
| `pnpm build` / `pnpm start` | Produktionsbygge och -server |
| `pnpm test` | Enhetstester (Vitest) |
| `pnpm test:watch` | Testerna i watch-läge |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:up` / `db:down` | Postgres + MinIO |
| `pnpm db:migrate` / `db:reset` | Migrationer |
| `pnpm db:seed` | Seed-data |
| `pnpm db:studio` | Prisma Studio |
| `pnpm db:parse-budget` / `db:import-budget` | Läser budgetkalkylen till JSON och importerar den |
| `pnpm fortnox:sync` | Synkar kontoplan, kostnadsställen och huvudbok |

## Struktur

All källkod ligger under `src/`; roten är konfiguration och data.

```
src/app/(app)/    Inloggade vyer. Varje route laddar sin egen data i en
                  Server Component och skickar den till en *-client.tsx.
src/app/api/      REST-endpoints. Varje handler börjar med gate() — se nedan.
src/components/   Delade komponenter; components/ui/ är primitiverna
                  (DataTable, Field, Button …).
src/lib/domain/   Rena regler och former — pengar, status, behörigheter,
                  matchning, bankfilen. Inga sidoeffekter, går att köra
                  var som helst och är det testerna täcker.
src/lib/server/   Det som rör omvärlden: databasen, miljön, lagringen,
                  hemligheterna, sessionen. Alla markerade `server-only`.
src/lib/data/     Läser databasen och lämnar ifrån sig de former skärmarna
                  använder. Enda stället schemat möter gränssnittet.
src/lib/api/      Det varje route-handler börjar med: gate(), fail(), åtkomst.
src/lib/budget/   Budgetmotorn: formeluttryck, rutnät, jämförelser, lås.
src/lib/ledger/   Huvudboken: BAS-strukturen, rapporterna, jämförelsen.
src/lib/fortnox/  Fortnox-API, SIE-tolkning och synk.
src/lib/ui/       Presentationshjälpare (formatering, klassnamn).
prisma/           Schema, migrationer, seed och budgetimporten.
messages/         Översättningar (sv är källspråket, en är översättningen).
public/           Statiska filer.
```

Uppdelningen i `lib/` går efter vad koden rör, inte vad den handlar om: allt i
`domain/` är rena funktioner som varken läser databasen eller känner till en
request, och allt i `server/` gör tvärtom. Gränsen är värd att hålla — den är
vad som gör domänlogiken testbar utan Postgres.

Två saker är värda att veta innan man ändrar något:

**Behörigheter härleds, aldrig hårdkodas.** Vem som får se, attestera och ändra
avgörs av `lib/domain/permissions.ts`, och varje API-route börjar med `gate()` från
`lib/api/guard.ts`, som läser rollerna från databasen (inte från sessionen — en
roll som tas bort ska sluta gälla direkt). Budgetens skrivningar går dessutom
genom `lib/budget/access.ts`, som hanterar låset.

**Pengar lagras i öre.** Databasen håller heltal öre; gränssnittet räknar i
kronor. `lib/domain/money.ts` är enda stället som konverterar — skriv aldrig `* 100`
för hand.

## Miljövariabler

`.env.example` listar allihop och `lib/server/env.ts` är koden som läser dem. Lokalt
fungerar tomma värden: fallbackarna motsvarar `docker-compose.yml`. I
produktion finns inga fallbackar — servern vägrar starta om något saknas eller
står kvar på ett utvecklingsvärde (`instrumentation.ts`).

Fortnox är frivilligt. Utan `FORTNOX_*` är integrationen avstängd och appen
säger det, i stället för att fela.

## Tester

`pnpm test` kör enhetstesterna för domänlogiken: valutakonverteringen,
attesträtten, inskicksspärren, budgetens formelmotor och bankfilstolkningen.
Allt som testas är rena funktioner över rena data, så sviten kör på under en
sekund utan databas.

Det som rör Prisma (`lib/data/`, `lib/ledger/report.ts`) testas medvetet inte
här — det kräver en riktig Postgres och är en annan sorts test.

## Arbeta med sektionens data

Bankfiler och budgetkalkyler är arbetsfiler, inte källkod. De innehåller riktiga
kontonummer och köp som går att knyta till enskilda medlemmar, och de hör hemma
i sektionens egen lagring — inte i en git-historik som varje klon bär med sig
för alltid. `*.csv`, `*.xls` och `*.xlsx` är därför ignorerade.

En bankfil låg en gång i historiken och fick städas bort i efterhand, vilket
kräver att historiken skrivs om för alla. Lägg dem bredvid repot i stället.

## Produktion

Postgres körs på sektionens k8s-kluster (CloudNativePG); `docker-compose.yml`
speglar den uppsättningen så nära att utveckling beter sig likadant.
Kvittobilderna ligger i en S3-kompatibel bucket och når aldrig webbläsaren
direkt — de streamas genom `/api/receipts/[id]`, så lagringen förblir intern.
