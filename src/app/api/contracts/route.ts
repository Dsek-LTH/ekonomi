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

  // CONTRACT always gets the table; OTHER only when a counterparty was
  // actually given, which the refine on CreateContract has already ruled out
  // for PROTOCOL. Either way `validFrom`/`validTo`/`status` stay null: naming
  // who an OTHER document is with does not give it a period or a workflow.
  const isContract = d.kind === "CONTRACT";
  const wantsAgreement = isContract || d.counterparty !== "";

  const contract = await prisma.contract.create({
    data: {
      kind: d.kind,
      title: d.title,
      // A DATE column: the day is the value, so it is built at midnight UTC
      // rather than from the server's own timezone, which would file a contract
      // signed on the 1st under the 31st for half the year. Only PROTOCOL/OTHER
      // use this; the refine on CreateContract guarantees PROTOCOL sent one.
      date: d.kind !== "CONTRACT" ? isoToDate(d.date) : null,
      // Normalised here rather than in the schema, because it is a rule about
      // the archive rather than about the request. See lib/contract/tags.ts.
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
              status: isContract ? d.status : null,
            },
          }
        : undefined,
    },
    select: { id: true },
  });

  return NextResponse.json(contract, { status: 201 });
}
