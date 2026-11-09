// A member's profile picture, for anyone signed in. The URL carries the version (`?v=`, see
// components/ui/user-avatar), so a response is cached for a year, private so no shared cache holds one.

import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { getObjectStream } from "@/lib/server/storage";

// GET /api/users/:id/avatar: the 256px WebP, or 404 for a member with none.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const user = await prisma.user.findUnique({ where: { id }, select: { avatarKey: true } });
  if (!user?.avatarKey) return fail(404, "avatar.notFound");

  let obj;
  try {
    obj = await getObjectStream(user.avatarKey);
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return fail(404, "avatar.notFound");
    console.error(`[avatar] ${id}: storage unreachable`, e);
    return fail(503, "avatar.storageUnavailable");
  }
  const headers = new Headers({
    "Content-Type": obj.contentType,
    "Cache-Control": "private, max-age=31536000, immutable",
  });
  if (obj.contentLength != null) headers.set("Content-Length", String(obj.contentLength));
  return new Response(obj.body, { headers });
}
