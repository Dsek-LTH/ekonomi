// The signed-in member's own profile picture. Only ever their own: there is no
// id in the path, so nobody can set or remove somebody else's.
//
// The crop happens in the browser (profile/avatar-dialog.tsx), which sends the
// square it cut. The server still decodes and re-encodes it, so what is stored
// is always a 256px WebP with no metadata, whatever was sent.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { SNIFF_BYTES, sniffReceiptType } from "@/lib/domain/file-type";
import { avatarImage, isNormalisableImage } from "@/lib/server/images";
import { avatarObjectKey, deleteObjectBestEffort, putObject } from "@/lib/server/storage";

const MAX_MB = 10;
const MAX_BYTES = MAX_MB * 1024 * 1024;

// PUT /api/profile/avatar: multipart, the picture in "file". Answers with the
// new version, which is what the picture's URL carries.
export async function PUT(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES + 64 * 1024) {
    return fail(413, "avatar.tooLarge", { values: { max: MAX_MB } });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "request.expectedMultipart");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "request.noFile");
  if (file.size === 0 || file.size > MAX_BYTES) {
    return fail(413, "avatar.tooLarge", { values: { max: MAX_MB } });
  }
  // What the bytes are, not what the browser said they were. A PDF passes the
  // receipt sniffer, so the image test is asked as well.
  const type = sniffReceiptType(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
  if (!type || !isNormalisableImage(type)) return fail(415, "avatar.notImage");

  let body: Buffer;
  try {
    body = await avatarImage(Buffer.from(await file.arrayBuffer()));
  } catch {
    return fail(422, "avatar.unreadable");
  }

  const now = new Date();
  const key = avatarObjectKey(g.actor.id, now.getTime());
  try {
    await putObject(key, body, "image/webp");
  } catch (e) {
    console.error(`[avatar] ${g.actor.id}: storage unreachable`, e);
    return fail(503, "avatar.storageUnavailable");
  }

  const before = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { avatarKey: true } });
  await prisma.user.update({
    where: { id: g.actor.id },
    data: { avatarKey: key, avatarUpdatedAt: now },
  });
  // The old picture only once the row no longer points at it, so a failure in
  // between leaves an orphan rather than a member with a broken image.
  if (before?.avatarKey && before.avatarKey !== key) await deleteObjectBestEffort(before.avatarKey);

  return NextResponse.json({ version: now.getTime() });
}

// DELETE /api/profile/avatar: back to the initials.
export async function DELETE() {
  const g = await gate();
  if (!g.ok) return g.res;

  const before = await prisma.user.findUnique({ where: { id: g.actor.id }, select: { avatarKey: true } });
  if (!before?.avatarKey) return new NextResponse(null, { status: 204 });
  await prisma.user.update({
    where: { id: g.actor.id },
    data: { avatarKey: null, avatarUpdatedAt: null },
  });
  await deleteObjectBestEffort(before.avatarKey);
  return new NextResponse(null, { status: 204 });
}
