import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

// The profile picture: only ever an image, always stored as the 256px WebP the
// server made of it, and the old one removed only once the row points at the
// new one.

const h = vi.hoisted(() => ({
  before: { avatarKey: null as string | null },
  update: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "maja",
  loadUser: async () => ({ name: "Maja", email: "m@dsek.se", studentId: "x", roles: [], capabilities: [] }),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: { user: { findUnique: async () => h.before, update: h.update } },
}));

vi.mock("@/lib/server/storage", () => ({
  avatarObjectKey: (id: string, v: number) => `avatars/${id}/${v}.webp`,
  putObject: h.put,
  deleteObjectBestEffort: h.del,
}));

const { PUT, DELETE } = await import("./route");

const upload = (bytes: Uint8Array, type = "image/png") => {
  const form = new FormData();
  form.append("file", new File([bytes], "me.png", { type }));
  return new Request("http://test/api/profile/avatar", { method: "PUT", body: form });
};

const png = async () =>
  new Uint8Array(
    await sharp({ create: { width: 600, height: 400, channels: 3, background: "#f280a1" } }).png().toBuffer(),
  );

beforeEach(() => {
  h.before = { avatarKey: null };
  for (const fn of [h.update, h.put, h.del]) fn.mockReset();
});

describe("uploading a profile picture", () => {
  it("stores a 256px WebP square and points the row at it", async () => {
    const res = await PUT(upload(await png()));
    expect(res.status).toBe(200);
    const [key, body, type] = h.put.mock.calls[0];
    expect(key).toMatch(/^avatars\/maja\/\d+\.webp$/);
    expect(type).toBe("image/webp");
    const meta = await sharp(body).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 256, 256]);
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "maja" }, data: expect.objectContaining({ avatarKey: key }) }),
    );
  });

  it("removes the old picture after the row has moved on", async () => {
    h.before = { avatarKey: "avatars/maja/1.webp" };
    await PUT(upload(await png()));
    expect(h.del).toHaveBeenCalledWith("avatars/maja/1.webp");
    expect(h.update.mock.invocationCallOrder[0]).toBeLessThan(h.del.mock.invocationCallOrder[0]);
  });

  it("refuses a PDF, whatever it is called", async () => {
    const res = await PUT(upload(new TextEncoder().encode("%PDF-1.7 not a picture"), "image/png"));
    expect(res.status).toBe(415);
    expect(h.put).not.toHaveBeenCalled();
  });
});

describe("removing it", () => {
  it("clears the row and the object", async () => {
    h.before = { avatarKey: "avatars/maja/1.webp" };
    const res = await DELETE();
    expect(res.status).toBe(204);
    expect(h.update).toHaveBeenCalledWith({ where: { id: "maja" }, data: { avatarKey: null, avatarUpdatedAt: null } });
    expect(h.del).toHaveBeenCalledWith("avatars/maja/1.webp");
  });
});
