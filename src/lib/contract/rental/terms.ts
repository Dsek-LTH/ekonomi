// The villkor an uthyrningsavtal is drawn under.
//
// THIS IS A DRAFT AND NEEDS AN OWNER: it is not legal advice. One person in styrelsen must
// read it and own it before the first contract goes outside the section.
//
// Swedish only: a contract is one document two parties are bound by, and two translations
// would be two agreements. Kept here, not in the .typ template, so wording and
// `TERMS_VERSION` change in one edit.

/**
 * Which wording a contract was drawn under (Contract.termsVersion), so a list can show
 * which contracts predate a change. Not evidence: the signed PDF carries the text. Bump it
 * when a change alters what the parties agree to, not for a typo.
 */
export const TERMS_VERSION = "2026-09.13";

/**
 * One piece of a clause, tagged by `kind` (the template branches on it, and Typst reads
 * this as plain JSON where a missing key and null are the same).
 */
export type TermsBlock =
  | { kind: "text"; text: string }
  /** Two columns. Wider does not fit the measure. */
  | { kind: "table"; head: [string, string]; rows: [string, string][] }
  /** Bulleted, for examples rather than steps. */
  | { kind: "list"; items: string[] };

export interface TermsSection {
  heading: string;
  body: TermsBlock[];
}

const p = (text: string): TermsBlock => ({ kind: "text", text });
const list = (...items: string[]): TermsBlock => ({ kind: "list", items });
const table = (head: [string, string], ...rows: [string, string][]): TermsBlock => ({
  kind: "table",
  head,
  rows,
});

/**
 * The clauses in reading order. No figure is substituted: the table on the document states
 * what was agreed, and repeating it in prose lets the two disagree. Clause numbers come
 * from this order, but references ("enligt § 5") are written into the text, and
 * rental-state.ts points at § 3 and the purpose hint in messages/ at § 1. Moving a clause
 * means finding every one.
 */
export const RENTAL_TERMS: readonly TermsSection[] = [
  {
    heading: "Vad avtalet gäller",
    body: [
      p(
        "Uthyraren hyr ut den utrustning som anges ovan till hyrestagaren, för den period, till den hyra och för det ändamål som anges ovan. Villkoren nedan gäller om parterna inte skriftligen har avtalat något annat.",
      ),
      p(
        "Utrustningen är uthyrarens egendom. Utan uthyrarens skriftliga medgivande får hyrestagaren inte låna ut, hyra ut, sälja eller pantsätta den, använda den för annat ändamål än det som anges ovan eller föra den utomlands.",
      ),

      p(
        "Den som undertecknar avtalet för en organisation intygar att denne har rätt att företräda organisationen.",
      ),
    ],
  },
  {
    heading: "Hyra och betalning",
    body: [
      p(
        "Hyran är den som anges ovan, med eventuell rabatt avräknad. Hyran och annan ersättning enligt avtalet faktureras och ska betalas senast det förfallodatum som anges på fakturan. Vid försenad betalning har uthyraren rätt till dröjsmålsränta enligt räntelagen samt ersättning för påminnelse- och inkassokostnader enligt lag.",
      ),
    ],
  },
  {
    heading: "Uthämtning, återlämning och kontroll",
    body: [
      p(
        "Utrustningen hämtas ut och återlämnas på de datum som anges ovan, i uthyrarens lokaler om inget annat har avtalats skriftligen. Den ska återlämnas rengjord och i samma skick och antal som vid uthämtningen, bortsett från normalt slitage.",
      ),
      // "Synliga": a hidden fault cannot be noted, and one inside the gear at pickup is § 6's.
      p(
        "Utrustningens skick antecknas vid uthämtningen och vid återlämningen. Hyrestagaren ska vid uthämtningen påtala synliga brister så att de antecknas. Synliga brister som inte har antecknats vid uthämtningen anses inte ha funnits då.",
      ),
      // No claim window for later damage: past the five working days the section can still
      // claim, it just has to prove it.
      p(
        "Uthyraren kontrollerar utrustningen, elektronik även i funktion, inom fem arbetsdagar från återlämningen. Skada som uthyraren meddelar hyrestagaren inom den tiden anses ha uppkommit under hyrestiden, om inte hyrestagaren visar något annat.",
      ),
    ],
  },
  {
    heading: "Försenad återlämning",
    body: [
      // Fee per day of the rent without discount, so a free loan is not also late for free.
      // Both end days count (`returnAt` is the last day, as in rental-state.ts and availability).
      // Assumes the à-pris is for the whole period: a per-day price would be divided twice.
      p(
        "Återlämnas utrustningen för sent betalar hyrestagaren en förseningsavgift för varje dag efter återlämningsdagen till och med den dag utrustningen återlämnas. Avgiften per dag är hyran ovan beräknad utan rabatt, delad med antalet hyresdagar. Både uthämtningsdagen och återlämningsdagen räknas som hyresdagar. Hyrestagaren ersätter dessutom skada som förseningen orsakar utöver avgiften, till exempel kostnaden för att hyra in motsvarande utrustning till någon som redan har bokat den.",
      ),

      p(
        "Har utrustningen inte återlämnats inom sju dagar efter återlämningsdagen får uthyraren behandla den som förlorad och kräva ersättning enligt § 5. Förseningsavgiften fram till dess ska ändå betalas.",
      ),
    ],
  },
  {
    heading: "Skada och förlust",
    body: [
      // No list of duties (storage, power, weather): a list invites the reading that what is
      // not on it is allowed.
      p(
        "Hyrestagaren ansvarar för utrustningen, även under transport, från uthämtningen till dess att den har återlämnats. Hyrestagaren ska hantera och förvara den varsamt och följa de instruktioner som lämnas vid uthämtningen.",
      ),
      // Everything is the renter's with named exceptions. Guests are named on purpose. The
      // last exception keeps this short of strict liability (36 § avtalslagen), and the renter
      // proves every part of it ("inbrott i låst lokal", not "stöld"; "kunnat förhindra"
      // carries the care requirement).
      p(
        "Under den tiden ersätter hyrestagaren all skada på och förlust av utrustningen, även när den orsakas av gäster, publik, artister, leverantörer eller andra som hyrestagaren har bjudit in eller ansvarar för, och även när orsaken är okänd. Hyrestagaren ersätter dock inte:",
      ),
      list(
        "normalt slitage,",
        "fel enligt § 6,",
        "skada eller förlust som hyrestagaren visar har orsakats av en händelse som varken hyrestagaren eller någon av dessa personer har orsakat eller hade kunnat förhindra, till exempel inbrott i låst lokal, brand eller åsknedslag.",
      ),
      p(
        "Skadas, förkommer eller stjäls utrustningen ska hyrestagaren genast meddela uthyraren. Stöld ska polisanmälas och en kopia av anmälan lämnas till uthyraren.",
      ),

      p("Ersättningen beräknas så här:"),
      table(
        ["Vad som hänt", "Vad hyrestagaren ersätter"],
        [
          "Skada som går att reparera",
          "Faktisk reparationskostnad, inklusive arbete, reservdelar och frakt, dock högst återanskaffningsvärdet",
        ],
        [
          "Förlust, stöld eller skada som inte går att reparera",
          "Återanskaffningsvärdet som anges ovan. Tillbehör som inte anges ovan, till exempel kablar och väskor, ersätts med vad motsvarande nya kostar.",
        ],
        ["Utrustning som inte återlämnats rengjord", "Kostnaden för rengöringen"],
      ),
    ],
  },
  {
    heading: "Fel på utrustningen och uthyrarens ansvar",
    body: [
      // The renter's right when the gear does not work. Only faults in the gear itself, and "i
      // motsvarande mån" since most rentals are one evening.
      p(
        "Har utrustningen ett fel som beror på utrustningen själv och inte på hur den har hanterats, till exempel ett dolt tillverkningsfel, ska hyrestagaren meddela uthyraren utan dröjsmål. Det är hyrestagaren som ska visa att felet är av det slaget. Uthyraren får avhjälpa felet eller byta ut utrustningen mot likvärdig. Går inte det, och kan utrustningen inte användas för sitt ändamål, sätts hyran ned i motsvarande mån.",
      ),
      // Claims from third parties over the event are the renter's, but not those from a
      // fault in the gear itself.
      p(
        "Hyrestagaren ansvarar för det arrangemang där utrustningen används, inklusive tillstånd och säkerheten på platsen. Riktar någon annan krav mot uthyraren som beror på arrangemanget eller på hur utrustningen har använts, ersätter hyrestagaren uthyraren för det.",
      ),
      // Capped at the rent (zero on a free loan), with an exception for gross negligence: a
      // cap covering that would be set aside and take the sentence with it.
      p(
        "Uthyraren ansvarar inte för indirekt skada, som utebliven vinst eller kostnader för arrangemanget. Uthyrarens ansvar i övrigt är begränsat till hyran. Begränsningarna gäller inte om uthyraren har orsakat skadan med uppsåt eller genom grov vårdslöshet.",
      ),
    ],
  },
  {
    heading: "Avbrytande och hävning",
    body: [
      p(
        "Uthyraren får avbryta användningen om förhållandena enligt uthyrarens bedömning utgör en risk för utrustningen eller för människor.",
      ),
      // The section is paid for fetching the gear, not given a right to take it. The day
      // after termination becomes the return date, so § 4 applies unchanged.
      p(
        "Uthyraren får häva avtalet med omedelbar verkan om hyrestagaren väsentligt bryter mot det, till exempel genom att hantera utrustningen vårdslöst, använda den i strid med § 1 eller inte betala i tid. Hyrestagaren ska då genast återlämna utrustningen och ersätta uthyrarens kostnad för att hämta den. Som återlämningsdag enligt § 4 räknas dagen efter hävningen.",
      ),

      p(
        "Hävningen sätter inte ned hyran. Hyrestagaren ersätter dessutom annan skada som avtalsbrottet orsakar uthyraren.",
      ),
    ],
  },
  {
    heading: "Befrielsegrunder",
    body: [
      // Weather and paying are not force majeure.
      p(
        "Part är inte skyldig att fullgöra ett åtagande som hindras av en omständighet utanför partens kontroll, till exempel myndighetsbeslut, krig, pandemi, strejk, omfattande elavbrott eller naturkatastrof. Parten ska genast meddela den andra parten. Befrielsen omfattar inte betalningsskyldighet eller hyrestagarens ansvar för utrustningen enligt § 5.",
      ),
      // Only before pickup: once the gear is out, the rent stands.
      p(
        "Kan uthyrningen av ett sådant skäl inte genomföras får vardera parten säga upp avtalet utan kostnad, så länge utrustningen inte har hämtats ut.",
      ),
    ],
  },
  {
    heading: "Tillämplig lag och tvist",
    body: [
      p(
        "Svensk lag gäller för detta avtal. Tvist som inte kan lösas i samförstånd prövas av svensk allmän domstol, med Lunds tingsrätt som första instans.",
      ),
    ],
  },
];
