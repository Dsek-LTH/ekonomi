// No GET: the list is a Server Component reading lib/data/contracts.ts directly.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canManageContracts } from "@/lib/domain/permissions";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateContract } from "@/lib/api/schemas/contract";
import { normaliseTags } from "@/lib/contract/tags";
import { isoToDate } from "@/lib/domain/date";

// POST /api/contracts
export async function POST(req: Request) {
  const g = await gate(canManageContracts, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateContract);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  // CONTRACT always gets the table; OTHER only with a counterparty. validFrom/validTo stay null for OTHER.
  const isContract = d.kind === "CONTRACT";
  const wantsAgreement = isContract || d.counterparty !== "";

  const contract = await prisma.contract.create({
    data: {
      kind: d.kind,
      title: d.title,
      // A DATE column: built at midnight UTC, not server timezone (a signing on the 1st would file under the 31st).
      date: d.kind !== "CONTRACT" ? isoToDate(d.date) : null,
      // Normalised here: a rule about the archive (lib/contract/tags.ts).
      tags: normaliseTags(d.tags),
      notes: d.notes ?? null,
      createdById: g.actor.id,
      agreement: wantsAgreement
        ? {
            create: {
              counterparty: d.counterparty,
              counterpartyOrgNo: d.counterpartyOrgNo ?? null,
              counterpartyAddress: d.counterpartyAddress ?? null,
              counterpartyPostalCode: d.counterpartyPostalCode ?? null,
              counterpartyCity: d.counterpartyCity ?? null,
              counterpartyId: d.counterpartyId ?? null,
              validFrom: isContract ? isoToDate(d.validFrom) : null,
              validTo: isContract ? isoToDate(d.validTo) : null,
            },
          }
        : undefined,
    },
    select: { id: true },
  });

  return NextResponse.json(contract, { status: 201 });
}
