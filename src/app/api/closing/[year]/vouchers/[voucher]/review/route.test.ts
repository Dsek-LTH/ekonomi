import { beforeEach, describe, expect, it, vi } from "vitest";

// Recording a bokslut review.
//
// What is pinned here is what makes a review worth anything: it lands in the
// reviewer's own pass and no other, nobody outside the two passes can make
// one, and it is refused when the voucher is no longer the one the screen was
// showing. Mocked at the session, the database and the fingerprint lookup.

const h = vi.hoisted(() => ({
  capabilities: ["AUDIT_REVIEW", "BOOKKEEPING_VIEW"] as string[],
  /** What the voucher's fingerprint is now, or null for no such voucher. */
  now: { series: "A", contentHash: "h1" } as { series: string; contentHash: string } | null,
  create: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "u5",
  loadUser: async () => ({
    name: "Rebecka Vik",
    email: "r@dsek.se",
    studentId: "re7890vi-s",
    roles: ["REVISOR"],
    capabilities: h.capabilities,
  }),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: { voucherReview: { create: h.create } },
}));

vi.mock("@/lib/data/closing", () => ({
  voucherFingerprintNow: async () => h.now,
}));

const { POST } = await import("./route");

const send = (body: unknown, voucher = "A-12") =>
  POST(
    new Request(`http://test/api/closing/1/vouchers/${voucher}/review`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ year: "1", voucher }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.capabilities = ["AUDIT_REVIEW", "BOOKKEEPING_VIEW"];
  h.now = { series: "A", contentHash: "h1" };
  h.create.mockResolvedValue({ id: "r1" });
});

describe("POST /api/closing/[year]/vouchers/[voucher]/review", () => {
  it("records a revisor's review in the auditors' pass, against the version seen", async () => {
    const res = await send({ status: "OK", contentHash: "h1" });
    expect(res.status).toBe(201);
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          financialYear: 1,
          series: "A",
          number: 12,
          pass: "AUDITOR",
          status: "OK",
          contentHash: "h1",
          reviewedById: "u5",
        }),
      }),
    );
  });

  it("records the treasury's review in its own pass", async () => {
    h.capabilities = ["BOOKKEEPING"];
    await send({ status: "QUESTION", contentHash: "h1" });
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pass: "PREPARER" }) }),
    );
  });

  it("ignores a pass named in the request", async () => {
    await send({ status: "OK", contentHash: "h1", pass: "PREPARER" });
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pass: "AUDITOR" }) }),
    );
  });

  it("refuses somebody who reviews in neither pass", async () => {
    h.capabilities = ["BOOKKEEPING_VIEW"];
    expect((await send({ status: "OK", contentHash: "h1" })).status).toBe(403);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses a voucher that changed after the page loaded", async () => {
    h.now = { series: "A", contentHash: "h2" };
    const res = await send({ status: "OK", contentHash: "h1" });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "closing.voucherChanged" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("is a 404 for a voucher the year does not have, or a key that is not one", async () => {
    h.now = null;
    expect((await send({ status: "OK", contentHash: "h1" })).status).toBe(404);
    expect((await send({ status: "OK", contentHash: "h1" }, "nonsense")).status).toBe(404);
    expect(h.create).not.toHaveBeenCalled();
  });
});
