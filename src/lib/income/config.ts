// Turning the routing table in the database into the configuration the intakt
// service expects.
//
// This is the join between the two halves. intakt used to read all of this from
// a config.yaml on the treasurer's laptop, which meant only whoever held the
// file could change it and the two sides could disagree about it. Now the rows
// are here, an admin edits them, and they are serialised into every request,
// so the service holds no configuration of its own and there is nothing to keep
// in step.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { IntaktCommittee, IntaktConfig, IntaktPrefix } from "./types";

/**
 * Why a config could not be built. Each is a message key under
 * `errors.income`. The routing table is admin-editable, so these are all
 * states a person can put the app into and has to be told how to get out of.
 */
export type IncomeConfigBlocker =
  | "noCommittees"
  | "noPrefixes"
  | "noFallbackPrefix"
  | "prefixAccountNotNumeric";

export type IncomeConfigResult =
  | { ok: true; config: IntaktConfig }
  | { ok: false; blocker: IncomeConfigBlocker; detail?: string };

/** Who the report is attested by, the person who asked for it. */
export interface IncomeAttestation {
  name: string;
  studentId: string;
}

/**
 * Build the config for one request.
 *
 * The attestation is the signed-in user rather than a setting, which is the
 * one genuine improvement the move to the app buys for free: intakt's YAML
 * named a single treasurer, so every report anyone generated carried their
 * name and STIL-ID regardless of who actually ran it.
 */
export async function buildIntaktConfig(
  attestation: IncomeAttestation,
): Promise<IncomeConfigResult> {
  const [committees, prefixes, fallbacks, accounts] = await Promise.all([
    prisma.resultUnitIncome.findMany({
      where: { active: true },
      include: {
        resultUnit: { select: { name: true } },
        defaultCostCenter: { select: { code: true } },
      },
    }),
    prisma.incomeProductPrefix.findMany({ include: { income: { select: { key: true, active: true } } } }),
    prisma.swishAmountFallback.findMany(),
    // The whole chart, but only as a lookup: what actually gets sent is one
    // description per account the prefixes route to (see below). Fetching all
    // of them costs one small indexed read and saves having to resolve the
    // prefixes first and then go back for their accounts.
    prisma.account.findMany({ select: { number: true, name: true } }),
  ]);

  if (committees.length === 0) return { ok: false, blocker: "noCommittees" };

  // A prefix pointing at a retired verksamhet would fail the service's own
  // validation, which checks exactly this. Dropping them here means retiring a
  // verksamhet is a supported thing to do rather than something that breaks
  // every fetch.
  const usable = prefixes.filter((p) => p.income.active);
  if (usable.length === 0) return { ok: false, blocker: "noPrefixes" };

  // Without a fallback an unrecognised product has nowhere to go. intakt's own
  // behaviour was to route it to a hardcoded "sk"; here it is an explicit flag,
  // and its absence is a configuration error rather than a silent default.
  if (!usable.some((p) => p.isFallback)) return { ok: false, blocker: "noFallbackPrefix" };

  const accountName = new Map(accounts.map((a) => [a.number, a.name]));

  const prefix_mappings: Record<string, IntaktPrefix> = {};
  const account_descriptions: Record<string, string> = {};
  for (const p of usable) {
    // The service's account field is an int, because BAS accounts are numbers.
    // A prefix carrying something else would be a 400 from the far side with
    // nothing pointing at which row caused it.
    const account = Number(p.account);
    if (!Number.isInteger(account)) {
      return { ok: false, blocker: "prefixAccountNotNumeric", detail: `${p.code} → ${p.account}` };
    }
    prefix_mappings[p.code] = { name: p.income.key, account };
    account_descriptions[p.account] = accountName.get(p.account) ?? "";
  }

  const committeeMap: Record<string, IntaktCommittee> = {};
  for (const c of committees) {
    committeeMap[c.key] = {
      // The unit's own name unless its documents need another form of it:
      // properName is an override now, not a second copy of the name.
      proper_name: c.properName ?? c.resultUnit.name,
      description: c.description,
      // Only carried so the service can echo it; the cost centre that actually
      // gets booked is the one on the report, which is editable in review.
      default_cost_center: c.defaultCostCenter?.code ?? "",
    };
  }

  const swish_amount_fallbacks: Record<string, string> = {};
  for (const f of fallbacks) swish_amount_fallbacks[String(f.amount)] = f.message;

  return {
    ok: true,
    config: {
      attestation: { name: attestation.name, stil_id: attestation.studentId },
      account_descriptions,
      prefix_mappings,
      committees: committeeMap,
      swish_amount_fallbacks,
    },
  };
}
