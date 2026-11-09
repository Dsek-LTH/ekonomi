// Contract status, derived and never stored: SIGNED once the signed copy is filed, else
// DRAFT, plus EXPIRED (a fact about today) for a signed contract past its period.
import type { Tone } from "@/lib/domain/status";
import { isImmutable, isSigned } from "@/lib/contract/file-roles";
import type { ContractFileRole, ContractKind, ContractStatus } from "@/lib/domain/types";

type ContractDisplayStatus = ContractStatus | "EXPIRED";

/** SIGNED once the signed copy is uploaded, else DRAFT. Null for PROTOCOL and OTHER. */
export function contractStatus(contract: {
  kind: ContractKind;
  files: readonly { role: ContractFileRole }[];
}): ContractStatus | null {
  if (contract.kind !== "CONTRACT") return null;
  return contract.files.some((f) => isSigned(f.role)) ? "SIGNED" : "DRAFT";
}

/**
 * Whether a signed contract has run out as of `today`. Drafts never expire. ISO days are
 * compared as strings: `validTo` is a DATE column, so no timezone shifts it.
 */
export function isExpired(
  contract: { status: ContractStatus | null; validTo: string | null },
  today: string,
): boolean {
  if (contract.status !== "SIGNED") return false;
  if (contract.validTo === null) return false;
  return contract.validTo < today;
}

/** The status to show, expiry included. Null for PROTOCOL/OTHER. */
export function displayStatus(
  contract: { status: ContractStatus | null; validTo: string | null },
  today: string,
): ContractDisplayStatus | null {
  if (contract.status === null) return null;
  return isExpired(contract, today) ? "EXPIRED" : contract.status;
}

/**
 * Whether the rental terms may still change (until the signed copy is uploaded).
 * Narrower than editing the archive record: tags, notes and title stay editable.
 */
export function canEditRental(contract: { files: readonly { role: ContractFileRole }[] }): boolean {
  return !contract.files.some((f) => isSigned(f.role) || isImmutable(f.role));
}

/** The colour per state, in the vocabulary of lib/domain/status.ts. EXPIRED is a warning, not danger. */
export const CONTRACT_STATUS_TONE: Record<ContractDisplayStatus, Tone> = {
  DRAFT: "neutral",
  SIGNED: "success",
  EXPIRED: "warning",
};

/**
 * The list's tabs in draw order. What each matches is asked in lib/data/contracts.ts; kept
 * here because the list runs in the browser. An expired contract stays under "Signerade".
 */
export const CONTRACT_TABS: readonly string[] = ["", "draft", "signed"];
