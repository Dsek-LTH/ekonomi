// The counterparty directory, as the settings screen and the two
// contract-creation forms read it.
//
// Two callers with two different needs, the same split rental-items.ts makes.
// The settings screen wants a count of how many contracts point at each row,
// so the dialog can say where it is used. The creation forms only pick from
// the list, and have no use for the counts.
import "server-only";

import { prisma } from "@/lib/server/db";

export interface CounterpartyRow {
  id: string;
  name: string;
  orgNo: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  /** Contracts pointing at this row. Drives whether it can be deleted. */
  usedBy: number;
}

/** What the contract forms pick from: one option per row still on offer. */
export interface CounterpartyOption {
  id: string;
  name: string;
  orgNo: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
}

const BY_NAME = [{ name: "asc" as const }];

export async function getCounterpartyRows(): Promise<CounterpartyRow[]> {
  const rows = await prisma.counterparty.findMany({
    orderBy: BY_NAME,
    include: { _count: { select: { agreements: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    orgNo: r.orgNo,
    address: r.address,
    postalCode: r.postalCode,
    city: r.city,
    email: r.email,
    phone: r.phone,
    notes: r.notes,
    usedBy: r._count.agreements,
  }));
}

export async function getCounterpartyOptions(): Promise<CounterpartyOption[]> {
  return prisma.counterparty.findMany({
    orderBy: BY_NAME,
    select: { id: true, name: true, orgNo: true, address: true, postalCode: true, city: true, email: true, phone: true },
  });
}
