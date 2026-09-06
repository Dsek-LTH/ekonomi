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
export const TERMS_VERSION = "2026-09";

export interface TermsSection {
  heading: string;
  /** One paragraph each. Rendered in order, as a numbered clause. */
  paragraphs: string[];
}

/**
 * The clauses, in the order they are read.
 *
 * `{deposit}` and `{returnAt}` are not substituted: what was agreed is stated
 * in the table above the terms on the document itself, and repeating a figure
 * in prose is how the two come to disagree. The clauses refer to the table.
 */
export const RENTAL_TERMS: readonly TermsSection[] = [
  {
    heading: "Vad avtalet gäller",
    paragraphs: [
      "Uthyraren hyr ut den utrustning som anges ovan till hyrestagaren, för den period och till den hyra som anges ovan. Utrustningen förblir uthyrarens egendom under hela hyrestiden.",
    ],
  },
  {
    heading: "Hyrestid och återlämning",
    paragraphs: [
      "Utrustningen hämtas och återlämnas på de datum som anges ovan, på överenskommen plats. Återlämning sker i samma skick som vid uthämtningen, bortsett från normalt slitage, och i samma antal.",
      "Om utrustningen inte återlämnas i tid har uthyraren rätt till ersättning för den skada förseningen orsakar, till exempel kostnaden för att hyra in motsvarande utrustning till någon annan som redan bokat den.",
    ],
  },
  {
    heading: "Hyra och deposition",
    paragraphs: [
      "Hyran betalas enligt överenskommelse. Deposition, om sådan tas ut, betalas senast vid uthämtningen.",
      "Depositionen återbetalas när utrustningen har återlämnats och kontrollerats, normalt inom två veckor. Uthyraren får räkna av kostnader för skada, förlust eller försenad återlämning från depositionen. Om kostnaderna överstiger depositionen kvarstår hyrestagarens ansvar för mellanskillnaden.",
    ],
  },
  {
    heading: "Hyrestagarens ansvar för utrustningen",
    paragraphs: [
      "Hyrestagaren ansvarar för utrustningen från uthämtning till dess att den är återlämnad och mottagen av uthyraren.",
      "Utrustningen ska användas på det sätt den är avsedd för och enligt de instruktioner som lämnas vid uthämtningen. Den får inte hyras ut vidare, lånas ut eller föras utomlands utan uthyrarens skriftliga medgivande.",
      "Hyrestagaren ska förvara utrustningen så att den inte utsätts för väta, stöld eller åverkan.",
    ],
  },
  {
    heading: "Skada och förlust",
    paragraphs: [
      "Om utrustningen skadas, förkommer eller stjäls under hyrestiden ska hyrestagaren omgående meddela uthyraren.",
      "Hyrestagaren ersätter skada som inte är normalt slitage. Vid förlust, stöld eller skada som inte går att reparera ersätts utrustningen med det återanskaffningsvärde som anges ovan.",
      "Stöld ska polisanmälas av hyrestagaren, och en kopia av anmälan lämnas till uthyraren.",
    ],
  },
  {
    heading: "Avbokning",
    paragraphs: [
      "Hyrestagaren kan avboka fram till sju dagar före uthämtningen utan kostnad. Vid avbokning därefter har uthyraren rätt till halva hyran.",
    ],
  },
  {
    heading: "Personuppgifter",
    paragraphs: [
      "Uthyraren behandlar hyrestagarens namn och kontaktuppgifter för att kunna fullgöra detta avtal. Uppgifterna sparas så länge det behövs för avtalet och för uthyrarens bokföring. Hyrestagaren har rätt att begära ut, rätta och radera sina uppgifter enligt dataskyddsförordningen.",
    ],
  },
  {
    heading: "Tillämplig lag och tvist",
    paragraphs: [
      "Svensk lag gäller för detta avtal. Tvist som inte kan lösas i samförstånd prövas av svensk allmän domstol, med Lunds tingsrätt som första instans.",
    ],
  },
];
