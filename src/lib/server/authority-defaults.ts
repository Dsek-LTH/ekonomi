// What the authority tables hold before anybody edits them.
//
// These three lists were the whole of lib/server/authentik-roles.ts and the
// role sets in lib/domain/permissions.ts, until authority became rows. They are
// kept because "the state the section started from" is worth being able to name
// after a screen has been editing it for a year. A seeded dev database gets
// them, and so does anyone who asks a settings screen to put a table back.
//
// They are not the source of truth for a running deployment. The database is.
// Nothing reads these to answer a question about authority; the only callers
// are the ones that *write* the tables.
//
// The 20260828120000_authority_is_data migration carries the same values in
// SQL, because a migration cannot import this file and because what it does is
// a different thing anyway: it is a one-time record of the day the lists
// stopped being code, and must keep saying what they said that day however
// these are edited afterwards.
//
// Deliberately NOT `server-only`, despite living in lib/server. It is three
// arrays of constants with no database, no session and no filesystem behind
// them, and prisma/seed.ts reads them through tsx, which cannot resolve that
// module at all: the marker made `pnpm db:seed` fail outright on a fresh
// checkout. The folder it sits in says who its callers are; the import would
// have said something untrue about what it needs.
import type { Capability, Role } from "@/lib/domain/types";

/** Authentik group → role. */
export const DEFAULT_GROUP_ROLES: readonly { group: string; role: Role }[] = [
  { group: "dsek.ordf", role: "ORDFORANDE" },
  { group: "dsek.skattm.mastare", role: "SKATTMASTARE" },
  { group: "dsek.skattm.vice_mastare", role: "VICE_SKATTMASTARE" },
  { group: "dsek.skattm.fm", role: "SKATTFORMAN" },

  // Alkohollagret. Deliberately a handful of named posts rather than the whole
  // `dsek.sex.*` tree: keeping the lagerbokföring is a job a few people do, and
  // the tree would hand it to every functionary in the committee. `dsek.sex.olfm`
  // and `dsek.sex.vinfm` (ölförman and vinförman) are absent on purpose.
  { group: "dsek.sex.mastare", role: "STOCKARE" },
  { group: "dsek.sex.vice_mastare", role: "STOCKARE" },
  { group: "dsek.sex.hov.mstr", role: "STOCKARE" },
  { group: "dsek.sex.pub.mastare", role: "STOCKARE" },
  { group: "dsek.sex.pub.vice_mastare", role: "STOCKARE" },
  { group: "dsek.sex.bar.mstr", role: "STOCKARE" },
  { group: "dsek.sex.bar.vice_mstr", role: "STOCKARE" },

  // Uthyrningen. A guess at the group, and safe to guess: this mapping is a row
  // the section edits in Inställningar → Roller, and a mapping written against
  // a group nobody holds grants nothing and is reported there as granting
  // nothing. Point it at the real group when you know which it is.
  { group: "dsek.km.uthyrning", role: "UTHYRNINGSANSVARIG" },

  // Revisorerna. A guess at the group, safe for the same reason as the one
  // above.
  { group: "dsek.revisor", role: "REVISOR" },
];

/**
 * Authentik group → result unit, by name.
 *
 * By name because a default cannot know an id. The rows are resolved against
 * whatever ResultUnit table exists when these are applied, and a name with no
 * unit behind it is simply skipped. The stored mapping is a foreign key.
 *
 * The signers are the guild's own (Dsek-LTH/web expenses/config.ts). Where their
 * committee head is not a `.mastare` (the three `.ordf` heads, Overphös,
 * Övermarskalken) the group is written out; there is no shape to pattern-match,
 * and pattern-matching post names is how the two wrong guesses this list used to
 * contain got in.
 */
export const DEFAULT_GROUP_RESULT_UNITS: readonly { group: string; unit: string }[] = [
  { group: "dsek.aktu.mastare", unit: "Aktivitetsutskottet" },
  { group: "dsek.cafe.mastare", unit: "Caféutskottet" },
  { group: "dsek.cpu.mastare", unit: "CPU" },
  { group: "dsek.fram.ordf", unit: "Framtidsutskottet" },
  { group: "dsek.infu.mastare", unit: "Infoutskottet" },
  { group: "dsek.km.mastare", unit: "Källarmästeriet" },
  { group: "dsek.overmarskalk", unit: "Medaljkommittén" },
  { group: "dsek.nari.mastare", unit: "Näringslivsutskottet" },
  { group: "dsek.noll.stab.oph", unit: "Nollningsutskottet" },
  { group: "dsek.sex.mastare", unit: "Sexmästeriet" },
  { group: "dsek.srd.ordf", unit: "Studierådet" },
  { group: "dsek.tackm.mastare", unit: "Tackmästeriet" },
  { group: "dsek.triv.mastare", unit: "Trivselutskottet" },
  { group: "dsek.val.ordf", unit: "Valberedningen" },
];

/**
 * Role → capability.
 *
 * BUDGET_VIEW is on every role because `canAccessBudget` used to be `() => true`
 * The budget is the section's, not the treasury's. Written out rather than
 * left implicit so that taking it away from a role is a decision somebody makes
 * on the screen, not a default nobody chose.
 */
export const DEFAULT_ROLE_CAPABILITIES: readonly { role: Role; capability: Capability }[] = [
  { role: "SKATTMASTARE", capability: "ADMIN" },
  { role: "ORDFORANDE", capability: "ADMIN" },

  // Chasing an utlägg is the admins' to begin with. A row like any other, so
  // the section can hand it to the treasury or a resultatansvarig as well.
  { role: "SKATTMASTARE", capability: "SEND_REMINDERS" },
  { role: "ORDFORANDE", capability: "SEND_REMINDERS" },

  { role: "SKATTMASTARE", capability: "BOOKKEEPING" },
  { role: "ORDFORANDE", capability: "BOOKKEEPING" },
  { role: "VICE_SKATTMASTARE", capability: "BOOKKEEPING" },
  { role: "SKATTFORMAN", capability: "BOOKKEEPING" },

  // The treasury proper, the people who actually work inside Fortnox. Narrower
  // than bookkeeping on purpose: the chair has bookkeeping access in this app
  // but no Fortnox login and no business unwinding an export.
  { role: "SKATTMASTARE", capability: "FORTNOX_LOGIN" },
  { role: "VICE_SKATTMASTARE", capability: "FORTNOX_LOGIN" },
  { role: "SKATTFORMAN", capability: "FORTNOX_LOGIN" },
  { role: "SKATTMASTARE", capability: "EXPORT_UNDO" },
  { role: "VICE_SKATTMASTARE", capability: "EXPORT_UNDO" },
  { role: "SKATTFORMAN", capability: "EXPORT_UNDO" },
  // Past the two-person rule on bokföring: the skattmästare alone. See
  // lib/domain/review.ts.
  { role: "SKATTMASTARE", capability: "REVIEW_OWN_BOOKING" },

  // Inställningar is the treasurer's alone. The chair counts as an admin for
  // expense authority and has no business in here.
  { role: "SKATTMASTARE", capability: "SETTINGS" },

  { role: "STOCKARE", capability: "STOCK_VIEW" },
  { role: "SKATTMASTARE", capability: "STOCK_VIEW" },
  { role: "ORDFORANDE", capability: "STOCK_VIEW" },
  { role: "STOCKARE", capability: "STOCK_MANAGE" },
  { role: "SKATTMASTARE", capability: "STOCK_MANAGE" },
  { role: "ORDFORANDE", capability: "STOCK_MANAGE" },

  { role: "SKATTMASTARE", capability: "BUDGET_VIEW" },
  { role: "ORDFORANDE", capability: "BUDGET_VIEW" },
  { role: "VICE_SKATTMASTARE", capability: "BUDGET_VIEW" },
  { role: "SKATTFORMAN", capability: "BUDGET_VIEW" },
  { role: "RESULTATANSVARIG", capability: "BUDGET_VIEW" },
  { role: "STOCKARE", capability: "BUDGET_VIEW" },
  { role: "UTHYRNINGSANSVARIG", capability: "BUDGET_VIEW" },
  { role: "ORDINARIE", capability: "BUDGET_VIEW" },

  { role: "SKATTMASTARE", capability: "BUDGET_COMMENT" },
  { role: "ORDFORANDE", capability: "BUDGET_COMMENT" },
  { role: "RESULTATANSVARIG", capability: "BUDGET_COMMENT" },

  // Sealing the adopted figures is the treasurer's call alone. The chair edits
  // budgets like any other admin but does not get to freeze them, or to move
  // money after the budget is voted through.
  { role: "SKATTMASTARE", capability: "BUDGET_LOCK" },
  { role: "SKATTMASTARE", capability: "BUDGET_CHANGE_LOCKED" },

  // Dispens från redovisningsfristen, for the same reason and to the same
  // person: a rule the section set, departed from for one claim, by the one who
  // answers for the money. The chair is an admin for expense authority and does
  // not get to hand out dispenser.
  { role: "SKATTMASTARE", capability: "EXPENSE_DEADLINE_WAIVE" },

  { role: "SKATTMASTARE", capability: "ATTEST_VIEW" },
  { role: "ORDFORANDE", capability: "ATTEST_VIEW" },
  { role: "RESULTATANSVARIG", capability: "ATTEST_VIEW" },

  // Avtal. Reading is given to the people who answer for the section's money
  // and its commitments; writing is narrower still. Deliberately not granted to
  // ORDINARIE by default, unlike the budget: the archive holds names, contact
  // details and terms belonging to people who are not members and never chose
  // to be visible to the whole section. Widen it in Inställningar if the
  // section decides otherwise.
  { role: "SKATTMASTARE", capability: "CONTRACT_VIEW" },
  { role: "ORDFORANDE", capability: "CONTRACT_VIEW" },
  { role: "VICE_SKATTMASTARE", capability: "CONTRACT_VIEW" },
  { role: "SKATTFORMAN", capability: "CONTRACT_VIEW" },
  { role: "RESULTATANSVARIG", capability: "CONTRACT_VIEW" },

  { role: "SKATTMASTARE", capability: "CONTRACT_MANAGE" },
  { role: "ORDFORANDE", capability: "CONTRACT_MANAGE" },

  // Firmateckning as the section's stadgar have it. These rows do not grant the
  // authority, they record who holds it, so the rental form offers the right
  // names. Each of them severally: one signature binds the section. If the
  // stadgar are ever changed to två i förening, this list is unaffected and the
  // rental form is what has to start asking for two.
  { role: "ORDFORANDE", capability: "FIRMATECKNARE" },
  { role: "SKATTMASTARE", capability: "FIRMATECKNARE" },

  // Uthyrningen: the rentals and the gear, and nothing else in the archive.
  // Not given CONTRACT_VIEW, which is the whole point of the role existing.
  { role: "UTHYRNINGSANSVARIG", capability: "RENTAL_VIEW" },
  { role: "UTHYRNINGSANSVARIG", capability: "RENTAL_MANAGE" },

  // Revisorerna read everything and change nothing. Every view capability, and
  // not ATTEST_VIEW: the attest queue is a list of work, and the utlägg in it
  // are already readable through BOOKKEEPING_VIEW.
  { role: "REVISOR", capability: "BOOKKEEPING_VIEW" },
  { role: "REVISOR", capability: "BUDGET_VIEW" },
  { role: "REVISOR", capability: "STOCK_VIEW" },
  { role: "REVISOR", capability: "CONTRACT_VIEW" },
  // The one thing a revisor writes: their review of the year's vouchers.
  { role: "REVISOR", capability: "AUDIT_REVIEW" },
];
