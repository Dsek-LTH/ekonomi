// Which of a contract's files are evidence. Pure, so the detail screen can hide the remove
// button the routes (lib/contract/files.ts) would refuse.
import type { ContractFileRole } from "@/lib/domain/types";

/**
 * Roles no screen may delete: the signing provider's log (bokföringslagen 7 kap, seven
 * years). Not SIGNED: one uploaded by mistake must be removable, behind a warning.
 */
const IMMUTABLE_ROLES: readonly ContractFileRole[] = ["EVIDENCE"];

export const isImmutable = (role: ContractFileRole): boolean => IMMUTABLE_ROLES.includes(role);

export const isSigned = (role: ContractFileRole): boolean => role === "SIGNED";
