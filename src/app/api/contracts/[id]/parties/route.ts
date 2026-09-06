// Record who signed a contract, or who is expected to.
//
// Its own endpoint rather than a field on the contract patch, because parties
// are rows with their own lifecycle: one is added when a rental is drawn, and
// another when somebody filing a 2019 scan decides it is worth typing in who
// put their name to it.
//
// Recording a signature here is a statement about something that happened
// elsewhere: on paper, in a meeting, years ago. It is not the app witnessing
// anything, which is exactly why `signatureMethod` defaults to PAPER and why
// phase 3's electronic signatures are written by the webhook rather than
// through this route.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canManageContracts } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateParty } from "@/lib/api/schemas/contract";
import { isoToDate } from "@/lib/domain/date";

// POST /api/contracts/:id/parties
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageContracts, "contract.noManageAccess");
  if (!g.ok) return g.res;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!contract) return fail(404, "contract.notFound");

  const parsed = await parseBody(req, CreateParty);
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  // A named member has to be one. Silently dropping an unknown id would file a
  // party that reads as an outsider when somebody meant one of ours.
  if (d.userId) {
    const user = await prisma.user.findUnique({ where: { id: d.userId }, select: { id: true } });
    if (!user) return fail(422, "user.unknown");
  }

  const party = await prisma.contractParty.create({
    data: {
      contractId: contract.id,
      role: d.role,
      name: d.name,
      email: d.email ?? null,
      phone: d.phone ?? null,
      orgName: d.orgName ?? null,
      orgNo: d.orgNo ?? null,
      title: d.title ?? null,
      userId: d.userId ?? null,
      signedAt: isoToDate(d.signedAt),
      // A date without a method is a signature nobody said how was made, and
      // everything recorded through this route happened away from the app.
      signatureMethod: d.signedAt ? (d.signatureMethod ?? "PAPER") : null,
    },
    select: { id: true },
  });

  return NextResponse.json(party, { status: 201 });
}
