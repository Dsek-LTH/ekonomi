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
export const TERMS_VERSION = "2026-09.5";

/**
 * One piece of a clause.
 *
 * A clause used to be a list of paragraphs and nothing else, which meant every
 * term had to be argued in prose even where prose is the worst way to say it.
 * The cancellation tiers were three sentences that the reader had to hold in
 * their head at once in order to compare them, which is exactly the job a table
 * does better and the reason the contract this was modelled on sets its own
 * cancellation terms as one.
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
 */
export const RENTAL_TERMS: readonly TermsSection[] = [
  {
    heading: "Vad avtalet gäller",
    body: [
      p("Uthyraren hyr ut den utrustning som anges ovan till hyrestagaren, för den period och till den hyra som anges ovan. Villkoren nedan gäller för uthyrningen om parterna inte skriftligen har avtalat något annat."),
    ],
  },
  {
    heading: "Utrustningen förblir uthyrarens egendom",
    body: [
      p("Utrustningen är uthyrarens egendom under hela hyrestiden. Utan uthyrarens skriftliga medgivande får hyrestagaren inte:"),
      list(
        "sälja, pantsätta eller överlåta utrustningen,",
        "låna ut eller hyra ut den vidare,",
        "flytta den till en annan plats än den som anges ovan,",
        "föra den utomlands.",
      ),
    ],
  },
  {
    heading: "Hyrestid och återlämning",
    body: [
      p("Utrustningen hämtas och återlämnas på de datum som anges ovan, på överenskommen plats. Återlämning sker i samma skick som vid uthämtningen, bortsett från normalt slitage, och i samma antal."),
      // The clause the whole damage question turns on. Handing the gear back is
      // not the same event as somebody plugging it in and finding it works, and
      // a contract that ends at the first of those leaves the lessor with no
      // way to raise a fault found an hour later. Professional Swedish rental
      // terms all draw this line: Renta's §2 makes the return the moment the
      // lessor issues a return receipt, not the moment the customer arrives.
      p("Utrustningen anses återlämnad först när uthyraren har tagit emot den och godkänt den efter kontroll. Utrustningens skick antecknas vid uthämtningen och vid återlämningen, och dessa anteckningar är utgångspunkten för bedömningen av skada."),
      p("Om utrustningen inte återlämnas i tid har uthyraren rätt till ersättning för den skada förseningen orsakar, till exempel kostnaden för att hyra in motsvarande utrustning till någon annan som redan bokat den."),
    ],
  },
  {
    heading: "Hyra och betalning",
    body: [
      p("Hyran är den som anges ovan. Rabatt som anges ovan är redan avräknad. Betalning sker senast det datum som anges ovan, eller om inget datum anges, senast vid uthämtningen."),
      // The reference contract's payment clause, and the half ours was missing:
      // a rent with no consequence for paying late is a rent that gets paid
      // late. Räntelagen is the ordinary Swedish reference and needs no figure.
      p("Vid försenad betalning har uthyraren rätt till dröjsmålsränta enligt räntelagen samt ersättning för påminnelse- och inkassokostnader enligt lag."),
      p("Kostnader för skada, förlust, försenad återlämning eller rengöring tillkommer utöver hyran och faktureras separat enligt punkterna nedan."),
    ],
  },
  {
    heading: "Hyrestagarens ansvar för utrustningen",
    body: [
      p("Hyrestagaren ansvarar för utrustningen från uthämtningen till dess att den är återlämnad och godkänd av uthyraren enligt punkt 3."),
      // Straight from the reference's SKADOR clause, which is explicit that the
      // organiser answers for everyone they brought. Without it, "det var inte
      // vi, det var en gäst" is an argument, and at a student event it is the
      // argument that will actually be made.
      p("Ansvaret omfattar även skada, förlust och merkostnad som orsakas av gäster, publik, artister, anlitade leverantörer eller andra personer som hyrestagaren har bjudit in eller ansvarar för."),
      p("Utrustningen ska användas på det sätt den är avsedd för och enligt de instruktioner som lämnas vid uthämtningen."),
    ],
  },
  {
    heading: "Förvaring och bevakning",
    body: [
      p("Hyrestagaren ska förvara utrustningen så att den inte utsätts för väta, stöld eller åverkan."),
      // The reference devotes a whole clause to overnight security, and the
      // case it describes is exactly the section's: gear left standing in a
      // hall between two evenings of a spex.
      p("Utrustning som lämnas kvar på platsen utanför den tid den används ska förvaras inlåst eller under bevakning. Hyrestagaren ansvarar för förlust, stöld och skada som uppkommer till följd av bristande förvaring eller bevakning."),
    ],
  },
  {
    heading: "El och yttre förhållanden",
    body: [
      // Both from the reference, and both are how sound equipment actually
      // dies: a bad socket in a nation cellar, or a speaker left out in the
      // rain at a gasque.
      p("Hyrestagaren ansvarar för att den el som utrustningen ansluts till är korrekt installerad och tillräcklig för utrustningen. Hyrestagaren ersätter skada som orsakas av felaktig, instabil eller otillräcklig elförsörjning, felkoppling, överspänning eller jordfel."),
      p("Vid användning utomhus ansvarar hyrestagaren för att utrustningen skyddas mot nederbörd, fukt och vind. Uthyraren har rätt att avbryta uthyrningen om förhållandena bedöms utgöra en risk för utrustningen eller för människor."),
    ],
  },
  {
    heading: "Inga ändringar av utrustningen",
    body: [
      p("Utrustningen får inte öppnas, byggas om, konfigureras om eller på annat sätt ändras. Merkostnad och skada som uppstår till följd av sådana åtgärder ersätts av hyrestagaren."),
    ],
  },
  {
    heading: "Skada och förlust",
    body: [
      p("Om utrustningen skadas, förkommer eller stjäls under hyrestiden ska hyrestagaren omgående meddela uthyraren. Stöld ska polisanmälas av hyrestagaren, och en kopia av anmälan lämnas till uthyraren."),
      // The reference is precise about what a repair actually costs, which ours
      // was not: it said only "återanskaffningsvärde", so everything short of a
      // total loss was undefined. As a table because it is two cases with two
      // answers, which is the shape a reader is looking for here.
      p("Skada som inte är normalt slitage ersätts enligt följande:"),
      table(
        ["Vad som hänt", "Vad hyrestagaren ersätter"],
        ["Skada som går att reparera", "Faktisk reparationskostnad, inklusive arbete, reservdelar, frakt och administration"],
        ["Förlust, stöld eller skada som inte går att reparera", "Återanskaffningsvärdet som anges ovan"],
      ),
      // Two things at once: the lessor gets a window in which a fault found
      // after the handover is still the renter's, and the renter gets a date
      // after which the matter is closed. The second half is not a concession,
      // it is what keeps the first half enforceable: an open-ended right to
      // charge for damage found whenever invites a court to set the clause
      // aside under 36 § avtalslagen.
      p("Uthyraren kontrollerar utrustningen efter återlämningen, elektronik även i funktion. Skada eller fel som upptäcks vid den kontrollen, och som inte rimligen kunde upptäckas direkt vid återlämningen, ersätts av hyrestagaren om uthyraren meddelar hyrestagaren inom fem arbetsdagar från återlämningen."),
      p("Därefter ansvarar hyrestagaren endast för skada som hyrestagaren har orsakat och som uthyraren inte kunde upptäcka vid kontrollen."),
    ],
  },
  {
    heading: "Fel på utrustningen",
    body: [
      // The other direction, which ours was silent on: the renter's right when
      // the gear does not work. A contract that only says what the renter owes
      // reads as one written against them, and it is also simply incomplete.
      p("Om utrustningen är felaktig vid uthämtningen eller går sönder under hyrestiden utan hyrestagarens vållande ska hyrestagaren meddela uthyraren utan dröjsmål. Uthyraren har rätt att avhjälpa felet eller att byta ut utrustningen mot likvärdig."),
      p("Om felet inte kan avhjälpas och utrustningen inte kan användas för sitt ändamål har hyrestagaren rätt till nedsättning av hyran för den tid utrustningen inte gick att använda. Uthyraren ansvarar inte för hyrestagarens indirekta skada, som utebliven vinst eller kostnader för arrangemanget i övrigt."),
    ],
  },
  {
    heading: "Avbokning",
    body: [
      p("Avbokning ska ske skriftligen. Vid avbokning har uthyraren rätt till ersättning enligt följande:"),
      // Tiered, as in the reference, and as a table for the same reason it is
      // one there. Ours was three sentences the reader had to hold in their
      // head at once to compare, which is the job a table does better.
      table(
        ["När avbokningen sker", "Ersättning till uthyraren"],
        ["Tidigare än 14 dagar före uthämtningen", "Ingen"],
        ["Mellan 8 och 14 dagar före uthämtningen", "25 procent av hyran"],
        ["7 dagar eller mindre före uthämtningen", "50 procent av hyran"],
      ),
      p("Om uthyraren hyr ut utrustningen till någon annan för samma period får ersättningen sättas ned i motsvarande mån."),
    ],
  },
  {
    heading: "Hyrestagarens arrangemang",
    body: [
      // From the reference's TILLSTÅND clause, cut down to what a section
      // lending out gear actually needs: the event is not the lessor's, and
      // neither are its permits.
      p("Hyrestagaren ansvarar för det arrangemang där utrustningen används, inklusive nödvändiga tillstånd, säkerheten på platsen och att gällande regler följs. Uthyraren ansvarar inte för arrangemanget eller för följderna av att tillstånd saknas."),
    ],
  },
  {
    heading: "Befrielsegrunder",
    body: [
      // Force majeure, which ours lacked entirely. Standard, and the list is
      // the reference's own, set as a list because the items are examples and
      // nothing is lost by reading them in any order.
      p("Part är befriad från ansvar för att inte ha fullgjort sina åtaganden om det beror på en omständighet utanför partens rimliga kontroll, till exempel:"),
      list(
        "myndighetsbeslut,",
        "strejk, pandemi eller krig,",
        "sabotage eller omfattande elavbrott,",
        "extrema väderförhållanden eller naturkatastrof.",
      ),
      p("Parten ska omgående meddela den andra parten om en sådan omständighet. Om hindret består längre än en vecka har vardera parten rätt att säga upp avtalet, varvid redan erlagd hyra för den tid utrustningen inte kunnat användas återbetalas."),
    ],
  },
  {
    heading: "Personuppgifter",
    body: [
      p("Uthyraren behandlar hyrestagarens och dess företrädares namn och kontaktuppgifter för att kunna fullgöra detta avtal. Uppgifterna sparas så länge det behövs för avtalet och för uthyrarens bokföring. Hyrestagaren har rätt att begära ut, rätta och radera sina uppgifter enligt dataskyddsförordningen."),
    ],
  },
  {
    heading: "Tillämplig lag och tvist",
    body: [
      p("Svensk lag gäller för detta avtal. Tvist som inte kan lösas i samförstånd prövas av svensk allmän domstol, med Lunds tingsrätt som första instans."),
    ],
  },
];
