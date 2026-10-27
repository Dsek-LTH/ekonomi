import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { TemplateItemBody } from "@/lib/api/schemas/closing";
import { canAccessSettings } from "@/lib/domain/permissions";

// Add a step to the bokslut template, last. The template is the handbook the
// next skattmästare starts from, so it is kept by whoever keeps Inställningar.
export async function POST(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;
  const parsed = await parseBody(req, TemplateItemBody);
  if (!parsed.ok) return parsed.res;

  const last = await prisma.checklistTemplateItem.aggregate({ _max: { sortOrder: true } });
  const item = await prisma.checklistTemplateItem.create({
    data: { ...parsed.data, sortOrder: (last._max.sortOrder ?? 0) + 10 },
    select: { id: true },
  });
  return NextResponse.json(item, { status: 201 });
}
