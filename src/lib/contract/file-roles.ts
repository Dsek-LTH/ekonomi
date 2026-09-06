// Which of a contract's files are evidence, and which are merely filed.
//
// A pure module of its own, because both sides of the app need the answer and
// they cannot share a server module to get it. The upload and delete routes
// enforce the rule (lib/contract/files.ts); the detail screen has to know it
// too, so that it does not draw a remove button it knows will be refused.
//
// Offering the button and then explaining the refusal is worse than not
// offering it: the reader learns the rule from an error rather than from the
// screen.
import type { ContractFileRole } from "@/lib/domain/types";

/**
 * Roles whose bytes are evidence: what somebody actually signed, and the
 * provider's log saying they did.
 *
 * Deleting one is not an edit, it is destroying the proof, and no screen in
 * this app offers it. Removing one is a database job done by somebody who has
 * read the retention rule first (bokföringslagen 7 kap keeps a contract that
 * underlies an invoice for seven years).
 */
const IMMUTABLE_ROLES: readonly ContractFileRole[] = ["SIGNED", "EVIDENCE"];

export const isImmutable = (role: ContractFileRole): boolean =>
  IMMUTABLE_ROLES.includes(role);
