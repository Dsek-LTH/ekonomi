// Seed fixtures for a fresh database. These were the frontend mock dataset
// (the UI now reads from the DB instead). The seed maps these into real rows;
// amounts are in plain SEK here and converted to öre on insert.
import type { User } from "../src/lib/domain/types";

/** A seeded person: the User columns that are actually inserted. */
export type SeedUser = Omit<User, "capabilities"> & { studentId: string };

export type SeedStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "BOOKED"
  | "EXPORTED";

/**
 * One cost-centre row of an utlägg, and what happened to it: who attested it,
 * and where the kontering put it.
 */
export interface SeedAllocation {
  costCenterCode: string;
  /** SEK, negative on a return. Omitted on a milersättning, which is valued from its journey. */
  amount?: number;
  /** Who signed this row. Every row from APPROVED on; some rows while pending. */
  attestedBy?: string;
  /** The BAS account the kontering put it on. Every row from BOOKED on. */
  account?: string;
  /** Fortnox project number on the kontering row, if any. */
  project?: string;
}

/**
 * An utlägg, as what the people involved did with it. Everything the app would
 * have written down along the way (the history, the reference, the voucher,
 * the bank row it was matched to) is derived from this by the seed, so the
 * pieces cannot disagree with each other. prisma/seed-expenses.ts checks the
 * result against the app's own rules and refuses to seed anything they would
 * not have allowed.
 */
export interface SeedExpense {
  title: string;
  submitterName: string;
  paymentType: "CARD" | "REIMBURSEMENT" | "MILEAGE";
  status: SeedStatus;
  /** How many days before the seed runs the purchase was made. Relative, so
   *  nothing drifts past the filing deadline as the calendar moves on. */
  daysAgo: number;
  allocations: SeedAllocation[];
  /** The till slip. Every utlägg but a milersättning has one. */
  receipt?: {
    merchant: string;
    address: string;
    time: string;
    /** SEK. They sum to the utlägg's amount. */
    lines: { name: string; amount: number }[];
    /** An eget utlägg's own way of paying, as the slip says it. A card
     *  purchase prints the section card it was made on. */
    paidWith?: string;
  };
  /** A milersättning's route and odometer readings. */
  journey?: { stops: string[]; odometerStart: number; odometerEnd: number };
  /** Who sent it back, and why. CHANGES_REQUESTED only. */
  changesRequested?: { by: string; comment: string };
  /** Who konterade it. BOOKED and later. */
  bookedBy?: string;
  /** Who bokförde it in Fortnox. EXPORTED only. */
  exportedBy?: string;
}

// Five fixed accounts, one per role. `studentId` is what the app keys a user on
// (Authentik's `preferred_username`), so these are fixed rather than generated,
// and a reseed must not move them. The dev sign-in lists whoever is in the
// table (app/login/dev-users.ts). Everyone else referenced in the fixtures gets
// a derived one; see `studentIdFor` in seed.ts.
// `capabilities` is not among them: it is resolved from the RoleCapability
// table per request (lib/server/capabilities.ts), never stored on a row, so a
// fixture that carried one would be stating something the database has no
// column for.
export const CURRENT_USERS: Record<string, SeedUser> = {
  ORDINARIE: {
    id: "u1",
    studentId: "el1234li-s",
    name: "Elsa Lindqvist",
    email: "elsa.lindqvist@user.dsek.se",
    roles: ["ORDINARIE"],
    initials: "EL",
  },
  RESULTATANSVARIG: {
    id: "u2",
    studentId: "os5678be-s",
    name: "Oskar Berg",
    email: "oskar.berg@user.dsek.se",
    roles: ["RESULTATANSVARIG"],
    initials: "OB",
  },
  SKATTFORMAN: {
    id: "u3",
    studentId: "lu9012ge-s",
    name: "Ludwig Gehlsdorf",
    email: "ludwig.gehlsdorf@user.dsek.se",
    roles: ["SKATTFORMAN"],
    initials: "LG",
  },
  SKATTMASTARE: {
    id: "u4",
    studentId: "ma3456ho-s",
    name: "Maja Holm",
    email: "maja.holm@user.dsek.se",
    roles: ["SKATTMASTARE"],
    initials: "MH",
  },
  REVISOR: {
    id: "u5",
    studentId: "re7890vi-s",
    name: "Rebecka Vik",
    email: "rebecka.vik@user.dsek.se",
    roles: ["REVISOR"],
    initials: "RV",
  },
};

/**
 * Who answers for which result unit, by the unit's name as the app has it
 * (the names Authentik's groups are mapped to, lib/server/authority-defaults).
 * The units and their cost centres themselves come from the real budget; see
 * prisma/seed.ts.
 */
export const UNIT_OWNERS: Record<string, string[]> = {
  "Oskar Berg": ["Näringslivsutskottet", "Infoutskottet"],
  "Klara Ström": ["Sexmästeriet", "Aktivitetsutskottet"],
};

// One of each status, and the cases a bookkeeper meets in a term: a split
// across result units, a row attested while the other still waits, a return,
// two milersättningar, a kontering with a project on it, and the skattmästare
// bokföring their own kontering (the one role exempt from the two-person rule).
export const EXPENSES: SeedExpense[] = [
  // ── Drafts ──
  {
    title: "Fika till sektionsmöte",
    submitterName: "Elsa Lindqvist",
    paymentType: "REIMBURSEMENT",
    status: "DRAFT",
    daysAgo: 3,
    allocations: [{ costCenterCode: "SEKT02", amount: 845.5 }],
    receipt: {
      merchant: "ICA Supermarket Tuna",
      address: "Tunavägen 39, Lund",
      time: "16:41",
      paidWith: "BANKKORT ****4419",
      lines: [
        { name: "Kanelbullar 24 st", amount: 287 },
        { name: "Bryggkaffe 4x500 g", amount: 239.8 },
        { name: "Mjölk 6 l", amount: 89.7 },
        { name: "Frukt", amount: 229 },
      ],
    },
  },
  {
    // Started from the card purchase on /bank, so it is matched already.
    title: "Banderoll till mottagningen",
    submitterName: "Elsa Lindqvist",
    paymentType: "CARD",
    status: "DRAFT",
    daysAgo: 4,
    allocations: [{ costCenterCode: "NOLL02", amount: 1290 }],
    receipt: {
      merchant: "Tryckeriet i Lund",
      address: "Bankgatan 7, Lund",
      time: "11:05",
      lines: [
        { name: "Banderoll 3x1 m", amount: 1090 },
        { name: "Öljetter, montering", amount: 200 },
      ],
    },
  },

  // ── Waiting for attest ──
  {
    // Split between two result units, and one of the two has signed.
    title: "Pizza till arbetskväll",
    submitterName: "Anton Falk",
    paymentType: "CARD",
    status: "PENDING_APPROVAL",
    daysAgo: 6,
    allocations: [
      { costCenterCode: "SEX02", amount: 1000 },
      { costCenterCode: "NARU01", amount: 560, attestedBy: "Oskar Berg" },
    ],
    receipt: {
      merchant: "Pizzeria Roma",
      address: "Stortorget 4, Lund",
      time: "19:22",
      lines: [
        { name: "Capricciosa x8", amount: 960 },
        { name: "Vegetariana x4", amount: 500 },
        { name: "Läsk 1,5 l x4", amount: 100 },
      ],
    },
  },
  {
    title: "Material till nollningen",
    submitterName: "Sara Nyberg",
    paymentType: "REIMBURSEMENT",
    status: "PENDING_APPROVAL",
    daysAgo: 5,
    allocations: [{ costCenterCode: "NOLL02", amount: 612.4 }],
    receipt: {
      merchant: "Panduro Hobby",
      address: "Mårtenstorget 3, Lund",
      time: "13:18",
      paidWith: "SWISH",
      lines: [
        { name: "Akrylfärg 4 burkar", amount: 316 },
        { name: "Penslar", amount: 89 },
        { name: "Kartong 20 ark", amount: 207.4 },
      ],
    },
  },
  {
    title: "Hämtning av ölbord",
    submitterName: "Jonas Ek",
    paymentType: "MILEAGE",
    status: "PENDING_APPROVAL",
    daysAgo: 8,
    allocations: [{ costCenterCode: "SEX03" }],
    journey: {
      stops: ["E-huset, Lund", "Hyrmaskiner Syd, Malmö", "E-huset, Lund"],
      odometerStart: 48210.4,
      odometerEnd: 48252.9,
    },
  },

  // ── Sent back ──
  {
    title: "Priser till idrottsdagen",
    submitterName: "Sara Nyberg",
    paymentType: "REIMBURSEMENT",
    status: "CHANGES_REQUESTED",
    daysAgo: 12,
    allocations: [{ costCenterCode: "AKTU07", amount: 2340 }],
    changesRequested: {
      by: "Klara Ström",
      comment: "Kvittot är otydligt. Ladda upp en skarpare bild, tack.",
    },
    receipt: {
      merchant: "Intersport",
      address: "Nova Lund, Lund",
      time: "10:47",
      paidWith: "BANKKORT ****7720",
      lines: [
        { name: "Medaljer 30 st", amount: 1290 },
        { name: "Pokal", amount: 650 },
        { name: "Presentkort", amount: 400 },
      ],
    },
  },

  // ── Attested, waiting for kontering ──
  {
    title: "Kontorsmaterial",
    submitterName: "Elsa Lindqvist",
    paymentType: "CARD",
    status: "APPROVED",
    daysAgo: 14,
    allocations: [{ costCenterCode: "SEKT06", amount: 432, attestedBy: "Maja Holm" }],
    receipt: {
      merchant: "Clas Ohlson",
      address: "Nova Lund, Lund",
      time: "14:32",
      lines: [
        { name: "Kollegieblock A4 5-pack", amount: 149 },
        { name: "Whiteboardpennor 4 st", amount: 89 },
        { name: "Gaffatejp svart 50 m", amount: 194 },
      ],
    },
  },
  {
    title: "Dekor till sittningen",
    submitterName: "Emma Sjö",
    paymentType: "REIMBURSEMENT",
    status: "APPROVED",
    daysAgo: 10,
    allocations: [{ costCenterCode: "SEX02", amount: 1187, attestedBy: "Klara Ström" }],
    receipt: {
      merchant: "Panduro Hobby",
      address: "Mårtenstorget 3, Lund",
      time: "15:02",
      paidWith: "BANKKORT ****2051",
      lines: [
        { name: "Ballonger 100 st", amount: 249 },
        { name: "Servetter guld 6 fp", amount: 354 },
        { name: "Ljusslingor 3 st", amount: 584 },
      ],
    },
  },
  {
    // A return: the money came back onto the card, so the amount is negative
    // and the kontering will run the other way round.
    title: "Retur: förlängningssladdar",
    submitterName: "Ludwig Gehlsdorf",
    paymentType: "CARD",
    status: "APPROVED",
    daysAgo: 9,
    allocations: [{ costCenterCode: "INFU01", amount: -349, attestedBy: "Oskar Berg" }],
    receipt: {
      merchant: "Clas Ohlson",
      address: "Nova Lund, Lund",
      time: "12:10",
      lines: [{ name: "Retur förlängningssladd 5 m", amount: -349 }],
    },
  },

  // ── Konterat, waiting to be bokfört ──
  {
    title: "Förtäring styrelsemöte",
    submitterName: "Anton Falk",
    paymentType: "CARD",
    status: "BOOKED",
    daysAgo: 20,
    allocations: [
      { costCenterCode: "STYR01", amount: 318, attestedBy: "Maja Holm", account: "4002" },
    ],
    bookedBy: "Ludwig Gehlsdorf",
    receipt: {
      merchant: "Espresso House",
      address: "Bantorget 2, Lund",
      time: "17:55",
      lines: [
        { name: "Kaffe 6 st", amount: 210 },
        { name: "Kanelbulle 6 st", amount: 108 },
      ],
    },
  },
  {
    // Split, konterat with a project, and konterat by the skattmästare:
    // somebody else bokför it, though she would be allowed to.
    title: "Inköp till nollegasquen",
    submitterName: "Klara Ström",
    paymentType: "REIMBURSEMENT",
    status: "BOOKED",
    daysAgo: 22,
    allocations: [
      { costCenterCode: "SEX04", amount: 1800, attestedBy: "Maja Holm", account: "4310", project: "1" },
      { costCenterCode: "NOLL04", amount: 950, attestedBy: "Maja Holm", account: "4310", project: "1" },
    ],
    bookedBy: "Maja Holm",
    receipt: {
      merchant: "Partykungen",
      address: "Stora Varvsgatan 11, Malmö",
      time: "12:36",
      paidWith: "BANKKORT ****6604",
      lines: [
        { name: "Bordsdukar 20 st", amount: 900 },
        { name: "Kronljus 200 st", amount: 900 },
        { name: "Bordsdekoration", amount: 950 },
      ],
    },
  },
  {
    title: "Körning till företagsmässan",
    submitterName: "Oskar Berg",
    paymentType: "MILEAGE",
    status: "BOOKED",
    daysAgo: 25,
    allocations: [{ costCenterCode: "NARU02", attestedBy: "Maja Holm", account: "7331" }],
    bookedBy: "Ludwig Gehlsdorf",
    journey: {
      stops: ["E-huset, Lund", "Malmömässan, Malmö", "E-huset, Lund"],
      odometerStart: 61204,
      odometerEnd: 61316,
    },
  },

  // ── Bokfört in Fortnox ──
  {
    title: "Trycksaker phadderverksamhet",
    submitterName: "Sara Nyberg",
    paymentType: "REIMBURSEMENT",
    status: "EXPORTED",
    daysAgo: 35,
    allocations: [
      { costCenterCode: "INFU01", amount: 4120, attestedBy: "Oskar Berg", account: "6150" },
    ],
    bookedBy: "Ludwig Gehlsdorf",
    exportedBy: "Maja Holm",
    receipt: {
      merchant: "Tryckeriet i Lund",
      address: "Bankgatan 7, Lund",
      time: "09:40",
      paidWith: "BANKKORT ****7720",
      lines: [
        { name: "Affischer A2 200 st", amount: 2400 },
        { name: "Flyers A5 1000 st", amount: 1720 },
      ],
    },
  },
  {
    title: "Pubinköp",
    submitterName: "Elsa Lindqvist",
    paymentType: "CARD",
    status: "EXPORTED",
    daysAgo: 30,
    allocations: [
      { costCenterCode: "SEX03", amount: 642, attestedBy: "Klara Ström", account: "4101" },
    ],
    bookedBy: "Maja Holm",
    exportedBy: "Ludwig Gehlsdorf",
    receipt: {
      merchant: "Willys",
      address: "Mobilvägen 10, Lund",
      time: "18:12",
      lines: [
        { name: "Chips 20 påsar", amount: 290 },
        { name: "Läsk 24 st", amount: 240 },
        { name: "Nötter", amount: 112 },
      ],
    },
  },
  {
    // Konterat and bokfört by the same person, which only the skattmästare
    // may do.
    title: "Kaffe till Skattmästeriet",
    submitterName: "Ludwig Gehlsdorf",
    paymentType: "CARD",
    status: "EXPORTED",
    daysAgo: 28,
    allocations: [
      { costCenterCode: "SKT01", amount: 189, attestedBy: "Maja Holm", account: "7603" },
    ],
    bookedBy: "Maja Holm",
    exportedBy: "Maja Holm",
    receipt: {
      merchant: "ICA Supermarket Tuna",
      address: "Tunavägen 39, Lund",
      time: "08:58",
      lines: [
        { name: "Bryggkaffe 2x500 g", amount: 119.8 },
        { name: "Mjölk 2 l", amount: 39.9 },
        { name: "Te 20 påsar", amount: 29.3 },
      ],
    },
  },
];

/**
 * Bank rows nothing has claimed. The card purchases utlägg were matched to are
 * not here: the seed writes those from the utlägg themselves, so the amount,
 * the date and the card always agree with what they settle.
 */
export interface SeedBankTransaction {
  daysAgo: number;
  description: string;
  /** SEK, negative going out. */
  amount: number;
  /** On this section card, or null for a row on the account itself. */
  cardLast4: string | null;
}

export const BANK_TRANSACTIONS: SeedBankTransaction[] = [
  // A card purchase still waiting for somebody to redovisa it.
  { daysAgo: 7, description: "SYSTEMBOLAGET LUND", amount: -980, cardLast4: "8842" },
  { daysAgo: 11, description: "SWISH INBETALNING", amount: 500, cardLast4: null },
  { daysAgo: 27, description: "BANKAVGIFT", amount: -75, cardLast4: null },
];

// Section cards ("sektionskort"). Only some members hold one, and a card
// purchase is redovisad by whoever holds the card it was made on.
export interface SeedCard {
  last4: string;
  holderName: string | null; // null = unassigned (admin to assign)
  /** The result unit the card is spent for, so its resultatansvarig reads
   *  its purchases on /bank. By the unit's name in the app. */
  resultUnit?: string;
}

export const CARDS: SeedCard[] = [
  { last4: "8842", holderName: "Elsa Lindqvist", resultUnit: "Sexmästeriet" },
  { last4: "5517", holderName: "Anton Falk", resultUnit: "Näringslivsutskottet" },
  { last4: "3310", holderName: "Ludwig Gehlsdorf", resultUnit: "Infoutskottet" },
  { last4: "9001", holderName: null }, // unassigned, appears in admin to be assigned
];

/**
 * Fortnox projects the konteringar can carry. Mirrored from Fortnox for real
 * (lib/fortnox/sync.ts); a fresh checkout has no Fortnox, so the seed makes
 * the ones its fixtures name.
 */
export const PROJECTS = [
  { number: "1", name: "Nollningen" },
  { number: "2", name: "Sittningar" },
];

/**
 * Accounts the fixtures post to that the budget does not already name. The
 * rest of the chart comes from the budget's own accounts.
 */
export const EXTRA_ACCOUNTS = [
  { number: "1580", name: "Fordringar för kontokort och kuponger" },
  { number: "1930", name: "Företagskonto" },
  { number: "2890", name: "Övriga kortfristiga skulder" },
  { number: "7331", name: "Skattefria bilersättningar" },
];

// ── Uthyrningsobjekt ──────────────────────────────────────────────
//
// The gear a section like this actually lets out, with values that are the
// right order of magnitude rather than exact. The replacement value is the
// figure that matters: it is what the liability clause of an uthyrningsavtal
// points at, so a catalogue whose values were all 100 kr would make the whole
// feature look harmless in a way it is not.
//
// The quantity is what availability is measured against: one mixer and one
// projector are the things a second contract for the same weekend has to be
// refused, and ten beer tables are the thing it does not.
//
// Öre, like every other amount in this app.
export const RENTAL_ITEMS = [
  {
    name: "Högtalare, aktiv 12 tum",
    quantity: 2,
    description: "Med stativ och kabel. Ett par räcker till en sittning.",
    dailyPriceOre: 25_000,
    replacementValueOre: 650_000,
  },
  {
    name: "Mixerbord, 8 kanaler",
    quantity: 1,
    description: null,
    dailyPriceOre: 15_000,
    replacementValueOre: 420_000,
  },
  {
    name: "Mikrofon, trådlös",
    quantity: 4,
    description: "Handhållen, med mottagare.",
    dailyPriceOre: 7_500,
    replacementValueOre: 180_000,
  },
  {
    name: "Mikrofonstativ",
    quantity: 6,
    description: null,
    dailyPriceOre: 2_500,
    replacementValueOre: 45_000,
  },
  {
    name: "Partytält 3×6 m",
    quantity: 2,
    description: "Väger en del. Kräver bil.",
    dailyPriceOre: 40_000,
    replacementValueOre: 900_000,
  },
  {
    name: "Ölbord med bänkar",
    quantity: 10,
    description: null,
    dailyPriceOre: 5_000,
    replacementValueOre: 120_000,
  },
  {
    // No standing price: what it costs depends on how long and for what, so it
    // is priced per rental. Null rather than zero, which would print
    // "0,00 kr per dag" on a contract.
    name: "Projektor",
    quantity: 1,
    description: "Med HDMI-kabel och duk.",
    dailyPriceOre: null,
    replacementValueOre: 550_000,
  },
];

// ── Lager ─────────────────────────────────────────────────────────
//
// What a section bar keeps: beer and cider by the can, spirits and wine by the
// bottle. Prices are what Systembolaget charges, in öre, which is what a
// delivery is booked at. A pallet in September, then a pub and a sittning in
// October drawing on it, so the list, the log, the events and the statistics
// all have a term's worth of movements to show.

export interface SeedStockProduct {
  name: string;
  kind: "UNIT" | "VOLUME";
  category: "OL" | "OVRIG_JASTDRYCK" | "VIN" | "SPRITDRYCK";
  abv: number;
  /** A can's or bottle's millilitres: `unitMl` for a UNIT, `nominalMl` for a VOLUME. */
  ml: number;
  costPriceOre: number;
  tags?: string[];
  /** How many came in with the September delivery. */
  delivered: number;
}

export const STOCK_PRODUCTS: SeedStockProduct[] = [
  { name: "Norrlands Guld 33 cl", kind: "UNIT", category: "OL", abv: 5.3, ml: 330, costPriceOre: 1290, tags: ["Pub"], delivered: 192 },
  { name: "Mariestads Export 50 cl", kind: "UNIT", category: "OL", abv: 5.3, ml: 500, costPriceOre: 1690, tags: ["Pub"], delivered: 96 },
  { name: "Brooklyn Lager 35,5 cl", kind: "UNIT", category: "OL", abv: 5.2, ml: 355, costPriceOre: 2290, delivered: 48 },
  { name: "Somersby Pear 33 cl", kind: "UNIT", category: "OVRIG_JASTDRYCK", abv: 4.5, ml: 330, costPriceOre: 1490, tags: ["Pub"], delivered: 96 },
  { name: "Absolut Vodka 70 cl", kind: "VOLUME", category: "SPRITDRYCK", abv: 40, ml: 700, costPriceOre: 26900, delivered: 6 },
  { name: "Fireball 70 cl", kind: "VOLUME", category: "SPRITDRYCK", abv: 33, ml: 700, costPriceOre: 24900, delivered: 4 },
  { name: "Jägermeister 70 cl", kind: "VOLUME", category: "SPRITDRYCK", abv: 35, ml: 700, costPriceOre: 26900, delivered: 4 },
  { name: "Santa Helena Merlot 75 cl", kind: "VOLUME", category: "VIN", abv: 13.5, ml: 750, costPriceOre: 8990, tags: ["Sittning"], delivered: 24 },
];

/**
 * A night, and what it took out and brought back, by product name. `out` is
 * sealed units; `back` is sealed units, and for a bottle `backOpen` the opened
 * ones that came back, by the level they were at.
 */
export interface SeedStockEvent {
  name: string;
  date: string;
  moves: { product: string; out: number; back?: number; backOpen?: Partial<Record<80 | 60 | 40 | 20, number>> }[];
}

export const STOCK_EVENTS: SeedStockEvent[] = [
  {
    name: "Pub 2 oktober",
    date: "2026-10-02",
    moves: [
      { product: "Norrlands Guld 33 cl", out: 96, back: 31 },
      { product: "Somersby Pear 33 cl", out: 48, back: 22 },
      { product: "Fireball 70 cl", out: 2, backOpen: { 40: 1 } },
      { product: "Jägermeister 70 cl", out: 1, backOpen: { 60: 1 } },
    ],
  },
  {
    name: "Höstsittningen",
    date: "2026-10-10",
    moves: [
      { product: "Mariestads Export 50 cl", out: 48, back: 12 },
      { product: "Santa Helena Merlot 75 cl", out: 18, back: 4, backOpen: { 20: 1 } },
      { product: "Absolut Vodka 70 cl", out: 2, back: 1 },
    ],
  },
];
