// The signed-in member's choice of emails, one kind at a time.
import { prisma } from "@/lib/server/db";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PutNotificationPreference } from "@/lib/api/schemas/admin";
import { isOnByDefault } from "@/lib/domain/notifications";

// PUT /api/profile/notifications: { kind, enabled }. A choice that matches the
// default deletes the row rather than writing one, so the table only ever holds
// departures and a changed default reaches everyone who never touched it.
export async function PUT(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PutNotificationPreference);
  if (!parsed.ok) return parsed.res;
  const { kind, enabled } = parsed.data;
  const userId = g.actor.id;

  if (enabled === isOnByDefault(kind)) {
    await prisma.notificationPreference.deleteMany({ where: { userId, kind } });
  } else {
    await prisma.notificationPreference.upsert({
      where: { userId_kind: { userId, kind } },
      create: { userId, kind, enabled },
      update: { enabled },
    });
  }
  return new Response(null, { status: 204 });
}
