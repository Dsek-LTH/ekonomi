import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { VoucherCommentBody } from "@/lib/api/schemas/closing";
import { canViewBookkeeping } from "@/lib/domain/permissions";
import { resolveVoucher } from "@/lib/server/closing-voucher";

// Add to a voucher's thread. Whoever may read the books may write in it: the
// revisorer ask, the treasury answers, and both are one conversation.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ year: string; voucher: string }> },
) {
  const g = await gate(canViewBookkeeping);
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, VoucherCommentBody);
  if (!parsed.ok) return parsed.res;

  const voucher = await resolveVoucher(await ctx.params, parsed.data.contentHash);
  if (!voucher.ok) return voucher.res;

  const comment = await prisma.voucherComment.create({
    data: {
      financialYear: voucher.financialYear,
      series: voucher.series,
      number: voucher.number,
      contentHash: parsed.data.contentHash,
      authorId: g.actor.id,
      body: parsed.data.body,
    },
    select: { id: true, body: true, createdAt: true },
  });
  return NextResponse.json(comment, { status: 201 });
}
