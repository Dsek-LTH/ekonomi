// File a contract in the archive.
//
// There is no GET beside this. The list is a Server Component that reads
// lib/data/contracts.ts directly, so an endpoint returning the same rows would
// be a second way to ask the same question and a second place for the access
// rule to be got wrong.
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

  const contract = await prisma.contract.create({
    data: {
      kind: d.kind,
      title: d.title,
      counterparty: d.counterparty,
      counterpartyOrgNo: d.counterpartyOrgNo ?? null,
      // A DATE column: the day is the value, so it is built at midnight UTC
      // rather than from the server's own timezone, which would file a contract
      // signed on the 1st under the 31st for half the year.
      validFrom: isoToDate(d.validFrom),
      validTo: isoToDate(d.validTo),
      // Normalised here rather than in the schema, because it is a rule about
      // the archive rather than about the request. See lib/contract/tags.ts.
      tags: normaliseTags(d.tags),
      notes: d.notes ?? null,
      status: d.status,
      createdById: g.actor.id,
    },
    select: { id: true },
  });

  return NextResponse.json(contract, { status: 201 });
}
