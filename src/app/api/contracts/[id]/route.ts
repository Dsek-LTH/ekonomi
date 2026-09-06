// Amend or remove one contract's archive record.
//
// "The record", not the agreement. A PATCH here changes the filing around a
// document: its title, who it is with, the dates it covers, the tags somebody
// will search by. It cannot change what a signed PDF says, because that is a
// file and this is a row, and the file is what the parties actually agreed to.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canManageContracts } from "@/lib/domain/permissions";
import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateContract } from "@/lib/api/schemas/contract";
import { normaliseTags } from "@/lib/contract/tags";
import { isImmutable } from "@/lib/contract/file-roles";
import { deleteObjectBestEffort } from "@/lib/server/storage";
import { isoToDate } from "@/lib/domain/date";
import type { Prisma } from "@/lib/generated/prisma/client";

// PATCH /api/contracts/:id
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageContracts, "contract.noManageAccess");
  if (!g.ok) return g.res;

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
  if (d.counterparty !== undefined) data.counterparty = d.counterparty;
  if (d.counterpartyOrgNo !== undefined) data.counterpartyOrgNo = d.counterpartyOrgNo;
  if (d.validFrom !== undefined) data.validFrom = isoToDate(d.validFrom);
  if (d.validTo !== undefined) data.validTo = isoToDate(d.validTo);
  if (d.tags !== undefined) data.tags = normaliseTags(d.tags);
  if (d.notes !== undefined) data.notes = d.notes;
  if (d.status !== undefined) data.status = d.status;

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
  const g = await gate(canManageContracts, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { id: true, files: { select: { id: true, role: true, objectKey: true } } },
  });
  if (!contract) return fail(404, "contract.notFound");

  // A contract holding evidence is not deletable from a screen. The rule is the
  // same one lib/contract/files.ts enforces per file, applied to the whole row:
  // a cascade would take the signed PDF with it, which is the one thing this
  // app must never do by accident. Somebody who genuinely has to remove one
  // does it in the database, having read the retention rule first.
  const evidence = contract.files.filter((f) => isImmutable(f.role));
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
