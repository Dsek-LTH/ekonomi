// The guide steps the signed-in member has been shown. See docs/guides.md.
import { prisma } from "@/lib/server/db";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PutSeenGuideSteps } from "@/lib/api/schemas/admin";

// PUT /api/profile/guides: { steps }. Shown and skipped are the same answer:
// either way the step does not come up by itself again. Running a guide a
// second time from the menu adds nothing new.
export async function PUT(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PutSeenGuideSteps);
  if (!parsed.ok) return parsed.res;

  const user = await prisma.user.findUnique({
    where: { id: g.actor.id },
    select: { seenGuideSteps: true },
  });
  const fresh = parsed.data.steps.filter((s) => !user?.seenGuideSteps.includes(s));
  if (user && fresh.length > 0) {
    await prisma.user.update({
      where: { id: g.actor.id },
      data: { seenGuideSteps: { push: [...new Set(fresh)] } },
    });
  }
  return new Response(null, { status: 204 });
}
