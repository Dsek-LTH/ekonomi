// The villkor an uthyrningsavtal is drawn under.
//
// ─────────────────────────────────────────────────────────────────────
//  THIS IS A DRAFT AND IT NEEDS AN OWNER IN THE SECTION.
//
//  It was written to cover the ground a gear rental normally has to cover, and
//  it is not legal advice. Before the first contract goes to somebody outside
//  the section, one person in styrelsen should read it, decide it says what the
//  section means, and own it from then on. Everything below is a starting point
//  for that conversation, not a finished instrument.
// ─────────────────────────────────────────────────────────────────────
//
// Here rather than in the .typ template, so the wording travels with the data
// that is handed to the typesetter. That is what lets `TERMS_VERSION` and the
// text it names be changed in one edit and stay in step, and it keeps the
// template about layout.
//
// Swedish only, and deliberately. Everything else in this app is bilingual
// because a screen follows its reader, but a contract is one document that two
// parties are bound by, and two translations of it are two agreements. The
// counterparty is a Swedish student organisation or a private person; the
// document is Swedish.

/**
 * Which wording a contract was drawn under, stamped onto the row
 * (Contract.termsVersion) at the moment it is drawn.
 *
 * Not evidence. The signed PDF is the record and always will be, and it carries
 * the text itself. This exists so that somebody reading a list of forty
 * contracts can tell which of them predate a change, without opening forty
 * files.
 *
 * Bump it whenever the text below changes in a way that alters what the parties
 * are agreeing to. A typo fixed in a heading is not that; a new clause is.
 */
export const TERMS_VERSION = "2026-09.13";

/**
 * One piece of a clause.
 *
 * A clause used to be a list of paragraphs and nothing else, which meant every
 * term had to be argued in prose even where prose is the worst way to say it.
 * What a renter owes for damage is several cases with one answer each, and in
 * sentences the reader has to hold them all in their head at once in order to
 * compare them. That is exactly the job a table does better.
 *
 * Tagged with `kind` rather than distinguished by which field is present: the
 * template branches on it, and Typst reads this as plain JSON where a missing
 * key and a null are the same thing.
 */
export type TermsBlock =
  | { kind: "text"; text: string }
  /** Two columns. Wider than that does not fit the measure, and a term that
   *  needs three is a term that should be split. */
  | { kind: "table"; head: [string, string]; rows: [string, string][] }
  /** Bulleted. For an enumeration where the items are examples rather than
   *  steps, so nothing is lost by reading them in any order. */
  | { kind: "list"; items: string[] };

export interface TermsSection {
  heading: string;
  /** Rendered in order, as one numbered clause. */
  body: TermsBlock[];
}

/** Shorthands, so the clauses below read as their text rather than as JSON. */
const p = (text: string): TermsBlock => ({ kind: "text", text });
const list = (...items: string[]): TermsBlock => ({ kind: "list", items });
const table = (
  head: [string, string],
  ...rows: [string, string][]
): TermsBlock => ({ kind: "table", head, rows });

/**
 * The clauses, in the order they are read.
 *
 * No figure is substituted into these. What was agreed is stated in the table
 * above the terms on the document itself, and repeating a figure in prose is
 * how the two come to disagree. The clauses refer to the table.
 *
 * The clause numbers are drawn from this order, but the references between
 * clauses ("enligt § 5") are written into the text, and so are a few outside
 * it: rental-state.ts points at § 3 and the purpose hint in messages/ at § 1.
 * Moving a clause means finding every one of those.
 */
export const RENTAL_TERMS: readonly TermsSection[] = [
  {
    heading: "Vad avtalet gäller",
    body: [
      p("Uthyraren hyr ut den utrustning som anges ovan till hyrestagaren, för den period, till den hyra och för det ändamål som anges ovan. Villkoren nedan gäller om parterna inte skriftligen har avtalat något annat."),
      p("Utrustningen är uthyrarens egendom. Utan uthyrarens skriftliga medgivande får hyrestagaren inte låna ut, hyra ut, sälja eller pantsätta den, använda den för annat ändamål än det som anges ovan eller föra den utomlands."),
      // The renter is often another section or förening, and whoever turns up to
      // sign is not always somebody who can bind it. This puts it in writing, so
      // if they could not, it is plain who said they could.
      p("Den som undertecknar avtalet för en organisation intygar att denne har rätt att företräda organisationen."),
    ],
  },
  {
    heading: "Hyra och betalning",
    body: [
      // The due date is the invoice's, not the contract's. The section sets it
      // when the invoice is sent, and a second date printed here would be a
      // second answer to the same question.
      //
      // "Annan ersättning" so that interest reaches a damage or late invoice
      // too. A damage invoice with no interest is the invoice that is still
      // open at the next årsmöte.
      p("Hyran är den som anges ovan, med eventuell rabatt avräknad. Hyran och annan ersättning enligt avtalet faktureras och ska betalas senast det förfallodatum som anges på fakturan. Vid försenad betalning har uthyraren rätt till dröjsmålsränta enligt räntelagen samt ersättning för påminnelse- och inkassokostnader enligt lag."),
    ],
  },
  {
    heading: "Uthämtning, återlämning och kontroll",
    body: [
      // The section's own premises unless something else was agreed, because
      // nothing on the document records a place, and "wherever was agreed" with
      // nothing written down is a place nobody can point to afterwards.
      p("Utrustningen hämtas ut och återlämnas på de datum som anges ovan, i uthyrarens lokaler om inget annat har avtalats skriftligen. Den ska återlämnas rengjord och i samma skick och antal som vid uthämtningen, bortsett från normalt slitage."),
      // The pickup note is only worth something if its silence means
      // something. Without the last sentence, "the scratch was already there" is
      // an argument; with it, the note settles the question.
      //
      // The renter is told to speak up, because the note is written by the
      // section. A presumption drawn from a note only one side could write in is
      // the kind a court sets aside, and then the note settles nothing.
      //
      // "Synliga", because a hidden fault cannot be noted by anybody, and a
      // fault that was already inside the gear at pickup is § 6's.
      p("Utrustningens skick antecknas vid uthämtningen och vid återlämningen. Hyrestagaren ska vid uthämtningen påtala synliga brister så att de antecknas. Synliga brister som inte har antecknats vid uthämtningen anses inte ha funnits då."),
      // Handing the gear back is not the same event as somebody plugging it in
      // and finding it works, so the section gets five working days to find
      // damage, and what it finds then is presumed to be the renter's.
      //
      // Nothing is said about damage found later. An earlier draft let the
      // section claim hidden damage for two weeks and no longer, which only
      // took away a right general law already gives it. Past the five days the
      // section can still claim, it just has to prove it.
      p("Uthyraren kontrollerar utrustningen, elektronik även i funktion, inom fem arbetsdagar från återlämningen. Skada som uthyraren meddelar hyrestagaren inom den tiden anses ha uppkommit under hyrestiden, om inte hyrestagaren visar något annat."),
    ],
  },
  {
    heading: "Försenad återlämning",
    body: [
      // A fee per day rather than only "the damage the delay causes", which the
      // section would have had to prove and put a figure on.
      //
      // The rent without discount, so a loan given for free or cheaply is not
      // also late for free. Both end days count, which is how rental-state.ts
      // and the availability rule read a period too: `returnAt` is the last day
      // the renter has the gear, not the first day they do not. That also means
      // a rental picked up and returned the same day is one day, never zero.
      //
      // This assumes the à-pris on the page is for the whole period. If it is a
      // price per day, the fee here comes out divided by the days a second time.
      p("Återlämnas utrustningen för sent betalar hyrestagaren en förseningsavgift för varje dag efter återlämningsdagen till och med den dag utrustningen återlämnas. Avgiften per dag är hyran ovan beräknad utan rabatt, delad med antalet hyresdagar. Både uthämtningsdagen och återlämningsdagen räknas som hyresdagar. Hyrestagaren ersätter dessutom skada som förseningen orsakar utöver avgiften, till exempel kostnaden för att hyra in motsvarande utrustning till någon som redan har bokat den."),
      // Seven days, so that late and lost do not stay the same argument for
      // ever. The fee already run up is not cancelled by the switch.
      p("Har utrustningen inte återlämnats inom sju dagar efter återlämningsdagen får uthyraren behandla den som förlorad och kräva ersättning enligt § 5. Förseningsavgiften fram till dess ska ändå betalas."),
    ],
  },
  {
    heading: "Skada och förlust",
    body: [
      // Whether the renter pays, and how much, in one clause. They were two, and
      // the second kept having to say it was only about the amount.
      //
      // No list of duties (storage, power, weather and so on). Leaving gear in
      // an unlocked room or out in the rain is exactly what "varsamt" asks
      // about, and a list only invites the reading that whatever is not on it
      // is allowed.
      p("Hyrestagaren ansvarar för utrustningen, även under transport, från uthämtningen till dess att den har återlämnats. Hyrestagaren ska hantera och förvara den varsamt och följa de instruktioner som lämnas vid uthämtningen."),
      // Everything is the renter's, with named exceptions, rather than a rule
      // for each kind of damage. A speaker that simply stops is the renter's
      // unless it is a fault in the gear itself (§ 6), and the renter shows that,
      // because the renter is the one who had it.
      //
      // Guests are named because "det var inte vi, det var en gäst" is the
      // argument that will actually be made.
      //
      // The last exception keeps this short of strict liability, which is the
      // kind of term a court adjusts under 36 § avtalslagen. It is written so
      // that the renter proves every part of it. "Stöld" used to be the example,
      // and a theft at an open party is exactly the case that should not be
      // excused, so it is "inbrott i låst lokal" now. "Kunnat förhindra" carries
      // the care requirement, and "dessa personer" keeps guests out of it.
      p("Under den tiden ersätter hyrestagaren all skada på och förlust av utrustningen, även när den orsakas av gäster, publik, artister, leverantörer eller andra som hyrestagaren har bjudit in eller ansvarar för, och även när orsaken är okänd. Hyrestagaren ersätter dock inte:"),
      list(
        "normalt slitage,",
        "fel enligt § 6,",
        "skada eller förlust som hyrestagaren visar har orsakats av en händelse som varken hyrestagaren eller någon av dessa personer har orsakat eller hade kunnat förhindra, till exempel inbrott i låst lokal, brand eller åsknedslag.",
      ),
      p("Skadas, förkommer eller stjäls utrustningen ska hyrestagaren genast meddela uthyraren. Stöld ska polisanmälas och en kopia av anmälan lämnas till uthyraren."),
      // As a table because it is three cases with three answers, which is the
      // shape a reader is looking for here. The accessories sentence is for
      // cables and cases, which are rarely lines of their own and are the
      // things that actually go missing.
      p("Ersättningen beräknas så här:"),
      table(
        ["Vad som hänt", "Vad hyrestagaren ersätter"],
        ["Skada som går att reparera", "Faktisk reparationskostnad, inklusive arbete, reservdelar och frakt, dock högst återanskaffningsvärdet"],
        ["Förlust, stöld eller skada som inte går att reparera", "Återanskaffningsvärdet som anges ovan. Tillbehör som inte anges ovan, till exempel kablar och väskor, ersätts med vad motsvarande nya kostar."],
        ["Utrustning som inte återlämnats rengjord", "Kostnaden för rengöringen"],
      ),
    ],
  },
  {
    heading: "Fel på utrustningen och uthyrarens ansvar",
    body: [
      // The other direction: the renter's right when the gear does not work.
      // A contract that only says what the renter owes reads as one written
      // against them, and it is also simply incomplete.
      //
      // Only faults in the gear itself, and "i motsvarande mån" rather than "for
      // that time", since most rentals are one evening and a mixer that loses a
      // channel is not a mixer that cannot be used at all.
      p("Har utrustningen ett fel som beror på utrustningen själv och inte på hur den har hanterats, till exempel ett dolt tillverkningsfel, ska hyrestagaren meddela uthyraren utan dröjsmål. Det är hyrestagaren som ska visa att felet är av det slaget. Uthyraren får avhjälpa felet eller byta ut utrustningen mot likvärdig. Går inte det, och kan utrustningen inte användas för sitt ändamål, sätts hyran ned i motsvarande mån."),
      // The event is the renter's, and so is anybody who comes after the
      // section over it: the guest who trips on a cable, the venue whose floor
      // was scratched. Claims that come from a fault in the gear itself are not
      // in "hur utrustningen har använts", and stay the section's.
      p("Hyrestagaren ansvarar för det arrangemang där utrustningen används, inklusive tillstånd och säkerheten på platsen. Riktar någon annan krav mot uthyraren som beror på arrangemanget eller på hur utrustningen har använts, ersätter hyrestagaren uthyraren för det."),
      // A cap, which the section had none of. Without one a faulty amplifier
      // at somebody's gasque could cost the section more than it has ever
      // earned from renting. Capped at the rent, which is zero on a free loan,
      // and that is why the exception is there: a cap that also covered gross
      // negligence would be set aside, and take the rest of the sentence with it.
      p("Uthyraren ansvarar inte för indirekt skada, som utebliven vinst eller kostnader för arrangemanget. Uthyrarens ansvar i övrigt är begränsat till hyran. Begränsningarna gäller inte om uthyraren har orsakat skadan med uppsåt eller genom grov vårdslöshet."),
    ],
  },
  {
    heading: "Avbrytande och hävning",
    body: [
      // For risks that are nobody's breach, a storm coming in over an outdoor
      // event. Careless handling is a breach, and that is the paragraph after.
      p("Uthyraren får avbryta användningen om förhållandena enligt uthyrarens bedömning utgör en risk för utrustningen eller för människor."),
      // The examples are the breaches that actually happen, and "väsentligt"
      // keeps a late invoice by a day from being one.
      //
      // The section is paid for fetching the gear rather than given a right to
      // go and take it, which would read as leave to walk into somebody's
      // premises. The day after termination becomes the return date, so being
      // late, and being lost after seven days, run through § 4 unchanged.
      p("Uthyraren får häva avtalet med omedelbar verkan om hyrestagaren väsentligt bryter mot det, till exempel genom att hantera utrustningen vårdslöst, använda den i strid med § 1 eller inte betala i tid. Hyrestagaren ska då genast återlämna utrustningen och ersätta uthyrarens kostnad för att hämta den. Som återlämningsdag enligt § 4 räknas dagen efter hävningen."),
      // A renter who breaks the contract badly enough to have it ended should
      // not get part of the rent back for it.
      p("Hävningen sätter inte ned hyran. Hyrestagaren ersätter dessutom annan skada som avtalsbrottet orsakar uthyraren."),
    ],
  },
  {
    heading: "Befrielsegrunder",
    body: [
      // Weather is not among the examples: a renter whose speakers stood out in
      // a storm must not be able to call it force majeure. Nor is paying, which
      // an event being cancelled never actually stops anybody doing.
      p("Part är inte skyldig att fullgöra ett åtagande som hindras av en omständighet utanför partens kontroll, till exempel myndighetsbeslut, krig, pandemi, strejk, omfattande elavbrott eller naturkatastrof. Parten ska genast meddela den andra parten. Befrielsen omfattar inte betalningsskyldighet eller hyrestagarens ansvar för utrustningen enligt § 5."),
      // Only before pickup. It used to be "after a week", which on a weekend
      // rental is after the rental is over, and it refunded rent for the time
      // gear "could not be used", which a cancelled event would have claimed
      // for the whole period. Once the gear is out, the rent stands.
      p("Kan uthyrningen av ett sådant skäl inte genomföras får vardera parten säga upp avtalet utan kostnad, så länge utrustningen inte har hämtats ut."),
    ],
  },
  {
    heading: "Tillämplig lag och tvist",
    body: [
      p("Svensk lag gäller för detta avtal. Tvist som inte kan lösas i samförstånd prövas av svensk allmän domstol, med Lunds tingsrätt som första instans."),
    ],
  },
];
