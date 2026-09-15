// Amend or remove one contract's archive record.
//
// "The record", not the agreement. A PATCH here changes the filing around a
// document: its title, who it is with, the dates it covers, the tags somebody
// will search by. It cannot change what a signed PDF says, because that is a
// file and this is a row, and the file is what the parties actually agreed to.
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
  // The wide grant is not required to reach this route, because a rental-only
  // holder may amend their own rentals. What they may touch is settled per
  // contract below, once its kind is known.
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

  // Absent means "leave it". Spelled out field by field rather than spread,
  // because three of them need converting and a blanket spread would write
  // `undefined` into columns Prisma would then leave alone by luck rather than
  // by intent.
  const data: Prisma.ContractUpdateInput = {};
  if (d.kind !== undefined) data.kind = d.kind;
  if (d.title !== undefined) data.title = d.title;
  if (d.date !== undefined) data.date = isoToDate(d.date);
  if (d.tags !== undefined) data.tags = normaliseTags(d.tags);
  if (d.notes !== undefined) data.notes = d.notes;

  // The agreement-specific fields, on their own table now (see
  // AgreementDetails). Sent for a CONTRACT row, which always already has the
  // AgreementDetails these fields update, or for an OTHER row naming a
  // counterparty for the first time, which does not: see the upsert below.
  // A meeting's minutes is never with anybody, so it never gets this table.
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
    // upsert, not update: a CONTRACT row already has this table, but an
    // OTHER row being given a counterparty for the first time does not.
    // The create side never sets validFrom/validTo, which only apply
    // to CONTRACT, and the edit form only ever sends those for CONTRACT
    // rows, which always take the update branch instead.
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

  // A contract holding its signed copy is not deletable whole. The signed file
  // has to be removed on its own first, behind its own warning, so a cascade
  // can never take it by accident.
  const evidence = contract.files.filter((f) => isSigned(f.role) || isImmutable(f.role));
  if (evidence.length > 0) {
    return fail(409, "contract.hasSignedFiles", { values: { count: evidence.length } });
  }

  // Bytes before rows, the same order every delete in this app uses. Best-effort
  // on the objects: the cascade below is what actually makes the contract gone,
  // and an object left behind is collectable, where a row pointing at nothing
  // is a document the archive offers and cannot open.
  for (const f of contract.files) await deleteObjectBestEffort(f.objectKey);
  await prisma.contract.delete({ where: { id: contract.id } });

  return new Response(null, { status: 204 });
}
