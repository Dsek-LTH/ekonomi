import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { ReviewVoucherBody } from "@/lib/api/schemas/closing";
import { reviewPassFor } from "@/lib/closing/review";
import { resolveVoucher } from "@/lib/server/closing-voucher";

// Record a review of one voucher, in the actor's own pass: the revisorer's for
// a revisor, the treasury's for whoever works the books. Not chosen by the
// request, so nobody can review in a pass that is not theirs.
//
// Appended, never updated. See VoucherReview in prisma/schema/closing.prisma.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ year: string; voucher: string }> },
) {
  const g = await gate();
  if (!g.ok) return g.res;
  const pass = reviewPassFor(g.actor.capabilities);
  if (!pass) return fail(403, "auth.denied");

  const parsed = await parseBody(req, ReviewVoucherBody);
  if (!parsed.ok) return parsed.res;

  const voucher = await resolveVoucher(await ctx.params, parsed.data.contentHash);
  if (!voucher.ok) return voucher.res;

  const review = await prisma.voucherReview.create({
    data: {
      financialYear: voucher.financialYear,
      series: voucher.series,
      number: voucher.number,
      pass,
      status: parsed.data.status,
      contentHash: parsed.data.contentHash,
      reviewedById: g.actor.id,
    },
    select: { id: true, pass: true, status: true, reviewedAt: true },
  });
  return NextResponse.json(review, { status: 201 });
}
