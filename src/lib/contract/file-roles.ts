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
 * Roles no screen may delete: the signing provider's log saying a signature
 * happened. Removing one is a database job done by somebody who has read the
 * retention rule first (bokföringslagen 7 kap keeps a contract that underlies
 * an invoice for seven years).
 *
 * Not SIGNED. The signed copy is what makes a contract Signerat, and one
 * uploaded by mistake has to be removable, so the contract page offers that
 * behind a warning instead.
 */
const IMMUTABLE_ROLES: readonly ContractFileRole[] = ["EVIDENCE"];

export const isImmutable = (role: ContractFileRole): boolean =>
  IMMUTABLE_ROLES.includes(role);

/** Whether a file is the signed copy of the agreement. See contractStatus. */
export const isSigned = (role: ContractFileRole): boolean => role === "SIGNED";
