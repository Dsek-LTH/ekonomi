// Amends the filing record (title, counterparty, dates, tags), never what a signed PDF says.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canManageRentals } from "@/lib/domain/permissions";
import { canManageKind } from "@/lib/data/contract-scope";
import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateContract } from "@/lib/api/schemas/contract";
import { normaliseTags } from "@/lib/contract/tags";
import { isImmutable, isSigned } from "@/lib/contract/file-roles";
import { deleteObjectBestEffort } from "@/lib/server/storage";
import { isoToDate } from "@/lib/domain/date";
import type { Prisma } from "@/lib/generated/prisma/client";

// PATCH /api/contracts/:id
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // The wide grant is not required: a rental-only holder may amend their own rentals, settled per contract below.
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const existing = await prisma.contract.findUnique({
    where: { id },
    select: { kind: true, rental: { select: { contractId: true } } },
  });
  if (!existing) return fail(404, "contract.notFound");
  if (!canManageKind(g.actor, { hasRental: existing.rental !== null })) {
    return fail(403, "contract.noManageAccess");
  }

  const parsed = await parseBody(req, UpdateContract);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  // Absent means "leave it": spelled out per field, not spread, so undefined is not written by luck.
  const data: Prisma.ContractUpdateInput = {};
  if (d.kind !== undefined) data.kind = d.kind;
  if (d.title !== undefined) data.title = d.title;
  if (d.date !== undefined) data.date = isoToDate(d.date);
  if (d.tags !== undefined) data.tags = normaliseTags(d.tags);
  if (d.notes !== undefined) data.notes = d.notes;

  // Agreement fields live on AgreementDetails: a CONTRACT row always has it, an OTHER row naming a counterparty for the first time does not (upsert below).
  const agreement: Prisma.AgreementDetailsUpdateInput = {};
  let touchesAgreement = false;
  if (d.counterparty !== undefined) {
    agreement.counterparty = d.counterparty;
    touchesAgreement = true;
  }
  if (d.counterpartyOrgNo !== undefined) {
    agreement.counterpartyOrgNo = d.counterpartyOrgNo;
    touchesAgreement = true;
  }
  if (d.counterpartyAddress !== undefined) {
    agreement.counterpartyAddress = d.counterpartyAddress;
    touchesAgreement = true;
  }
  if (d.counterpartyPostalCode !== undefined) {
    agreement.counterpartyPostalCode = d.counterpartyPostalCode;
    touchesAgreement = true;
  }
  if (d.counterpartyCity !== undefined) {
    agreement.counterpartyCity = d.counterpartyCity;
    touchesAgreement = true;
  }
  if (d.counterpartyId !== undefined) {
    agreement.counterpartyRef = d.counterpartyId
      ? { connect: { id: d.counterpartyId } }
      : { disconnect: true };
    touchesAgreement = true;
  }
  if (d.validFrom !== undefined) {
    agreement.validFrom = isoToDate(d.validFrom);
    touchesAgreement = true;
  }
  if (d.validTo !== undefined) {
    agreement.validTo = isoToDate(d.validTo);
    touchesAgreement = true;
  }
  if (touchesAgreement) {
    if (existing.kind === "PROTOCOL") return fail(400, "contract.counterpartyNotAllowed");
    // upsert: an OTHER row may not have the table yet. Create never sets validFrom/validTo (CONTRACT only).
    data.agreement = {
      upsert: {
        update: agreement,
        create: {
          counterparty: d.counterparty ?? null,
          counterpartyOrgNo: d.counterpartyOrgNo ?? null,
          counterpartyAddress: d.counterpartyAddress ?? null,
          counterpartyPostalCode: d.counterpartyPostalCode ?? null,
          counterpartyCity: d.counterpartyCity ?? null,
          counterpartyRef: d.counterpartyId ? { connect: { id: d.counterpartyId } } : undefined,
        },
      },
    };
  }

  const updated = await orNotFound(
    () => prisma.contract.update({ where: { id }, data, select: { id: true } }),
    "contract.notFound",
  );
  if (updated instanceof NextResponse) return updated;

  return new Response(null, { status: 204 });
}

// DELETE /api/contracts/:id
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageRentals, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: {
      id: true,
      rental: { select: { contractId: true } },
      files: { select: { id: true, role: true, objectKey: true } },
    },
  });
  if (!contract) return fail(404, "contract.notFound");
  if (!canManageKind(g.actor, { hasRental: contract.rental !== null })) {
    return fail(403, "contract.noManageAccess");
  }

  // A contract holding its signed copy is not deletable whole: remove the signed file first, behind its own warning.
  const evidence = contract.files.filter((f) => isSigned(f.role) || isImmutable(f.role));
  if (evidence.length > 0) {
    return fail(409, "contract.hasSignedFiles", { values: { count: evidence.length } });
  }

  // Bytes before rows, best-effort: an orphaned object is collectable, a row pointing at nothing is not openable.
  for (const f of contract.files) await deleteObjectBestEffort(f.objectKey);
  await prisma.contract.delete({ where: { id: contract.id } });

  return new Response(null, { status: 204 });
}
