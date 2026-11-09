// Defaults that seed the authority tables. Not the source of truth (the database is), and
// deliberately not `server-only` because prisma/seed.ts imports it through tsx.
import type { Capability, Role } from "@/lib/domain/types";

/** Authentik group → role. */
export const DEFAULT_GROUP_ROLES: readonly { group: string; role: Role }[] = [
  { group: "dsek.ordf", role: "ORDFORANDE" },
  { group: "dsek.skattm.mastare", role: "SKATTMASTARE" },
  { group: "dsek.skattm.vice_mastare", role: "VICE_SKATTMASTARE" },
  { group: "dsek.skattm.fm", role: "SKATTFORMAN" },

  // Deliberately a handful of named posts, not the whole `dsek.sex.*` tree.
  { group: "dsek.sex.mastare", role: "STOCKARE" },
  { group: "dsek.sex.vice_mastare", role: "STOCKARE" },
  { group: "dsek.sex.hov.mstr", role: "STOCKARE" },
  { group: "dsek.sex.pub.mastare", role: "STOCKARE" },
  { group: "dsek.sex.pub.vice_mastare", role: "STOCKARE" },
  { group: "dsek.sex.bar.mstr", role: "STOCKARE" },
  { group: "dsek.sex.bar.vice_mstr", role: "STOCKARE" },

  // Guess at the group; an unheld group grants nothing and is reported as such in Roller.
  { group: "dsek.km.uthyrning", role: "UTHYRNINGSANSVARIG" },

  // Guess at the group.
  { group: "dsek.revisor", role: "REVISOR" },
];

/** Authentik group to result unit, by name (a default cannot know an id; unknown names are skipped). */
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

/** Role to capability. */
export const DEFAULT_ROLE_CAPABILITIES: readonly { role: Role; capability: Capability }[] = [
  { role: "SKATTMASTARE", capability: "ADMIN" },
  { role: "ORDFORANDE", capability: "ADMIN" },

  { role: "SKATTMASTARE", capability: "SEND_REMINDERS" },
  { role: "ORDFORANDE", capability: "SEND_REMINDERS" },

  { role: "SKATTMASTARE", capability: "BOOKKEEPING" },
  { role: "ORDFORANDE", capability: "BOOKKEEPING" },
  { role: "VICE_SKATTMASTARE", capability: "BOOKKEEPING" },
  { role: "SKATTFORMAN", capability: "BOOKKEEPING" },

  // Narrower than bookkeeping: the chair has no Fortnox login.
  { role: "SKATTMASTARE", capability: "FORTNOX_LOGIN" },
  { role: "VICE_SKATTMASTARE", capability: "FORTNOX_LOGIN" },
  { role: "SKATTFORMAN", capability: "FORTNOX_LOGIN" },
  { role: "SKATTMASTARE", capability: "INVOICE_TRIAGE" },
  { role: "VICE_SKATTMASTARE", capability: "INVOICE_TRIAGE" },
  { role: "SKATTFORMAN", capability: "INVOICE_TRIAGE" },
  { role: "SKATTMASTARE", capability: "EXPORT_UNDO" },
  { role: "VICE_SKATTMASTARE", capability: "EXPORT_UNDO" },
  { role: "SKATTFORMAN", capability: "EXPORT_UNDO" },
  // Past the two-person rule on bokföring: the skattmästare alone.
  { role: "SKATTMASTARE", capability: "REVIEW_OWN_BOOKING" },

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

  // Sealing adopted figures is the treasurer's alone.
  { role: "SKATTMASTARE", capability: "BUDGET_LOCK" },
  { role: "SKATTMASTARE", capability: "BUDGET_CHANGE_LOCKED" },

  { role: "SKATTMASTARE", capability: "EXPENSE_DEADLINE_WAIVE" },

  { role: "SKATTMASTARE", capability: "MEMBER_SCORE_VIEW" },

  { role: "SKATTMASTARE", capability: "ATTEST_VIEW" },
  { role: "ORDFORANDE", capability: "ATTEST_VIEW" },
  { role: "RESULTATANSVARIG", capability: "ATTEST_VIEW" },

  // Not granted to ORDINARIE: the archive holds personal data of non-members.
  { role: "SKATTMASTARE", capability: "CONTRACT_VIEW" },
  { role: "ORDFORANDE", capability: "CONTRACT_VIEW" },
  { role: "VICE_SKATTMASTARE", capability: "CONTRACT_VIEW" },
  { role: "SKATTFORMAN", capability: "CONTRACT_VIEW" },
  { role: "RESULTATANSVARIG", capability: "CONTRACT_VIEW" },

  { role: "SKATTMASTARE", capability: "CONTRACT_MANAGE" },
  { role: "ORDFORANDE", capability: "CONTRACT_MANAGE" },

  // Records who holds firmateckning (each severally), so the rental form offers the right names.
  { role: "ORDFORANDE", capability: "FIRMATECKNARE" },
  { role: "SKATTMASTARE", capability: "FIRMATECKNARE" },

  // Uthyrningen: rentals and gear only, not CONTRACT_VIEW.
  { role: "UTHYRNINGSANSVARIG", capability: "RENTAL_VIEW" },
  { role: "UTHYRNINGSANSVARIG", capability: "RENTAL_MANAGE" },

  // Revisorerna read everything and change nothing. No ATTEST_VIEW.
  { role: "REVISOR", capability: "BOOKKEEPING_VIEW" },
  { role: "REVISOR", capability: "BUDGET_VIEW" },
  { role: "REVISOR", capability: "STOCK_VIEW" },
  { role: "REVISOR", capability: "CONTRACT_VIEW" },
  { role: "REVISOR", capability: "AUDIT_REVIEW" },
];
