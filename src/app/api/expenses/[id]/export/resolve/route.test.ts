import { beforeEach, describe, expect, it, vi } from "vitest";

// Resolving an export that ended without an answer. A person has looked in
// Fortnox; this is where they say what they found. Both answers let go of the
// lock, and "there is no voucher" is the one that, wrong, files it twice. So
// what is pinned here is who may say it, when it may be said, and that it acts
// only on the very lock that was looked into.

const h = vi.hoisted(() => ({
  capabilities: ["BOOKKEEPING", "EXPORT_UNDO"] as string[],
  expense: null as Record<string, unknown> | null,
  updateMany: vi.fn(),
  verificationUpdate: vi.fn(),
  event: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "skattmastare",
  loadUser: async () => ({
    name: "Skattmästaren",
    email: "s@dsek.se",
    studentId: "sk1234tm-s",
    roles: ["SKATTMASTARE"],
    capabilities: h.capabilities,
  }),
}));

vi.mock("@/lib/server/db", () => {
  const tx = {
    expense: { updateMany: h.updateMany },
    verification: { update: h.verificationUpdate },
    expenseEvent: { create: h.event },
  };
  return {
    prisma: {
      expense: { findUnique: async () => h.expense },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

vi.mock("@/lib/server/notify", () => ({ notify: async () => 0, deliverSoon: () => {} }));
vi.mock("@/lib/email/content", () => ({ expenseNotice: () => ({}) }));

const { POST } = await import("./route");

const CLAIMED_AT = new Date("2026-10-12T10:00:00.000Z");

const resolve = (body: unknown) =>
  POST(
    new Request("http://test/api/expenses/e1/export/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "e1" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.capabilities = ["BOOKKEEPING", "EXPORT_UNDO"];
  h.expense = {
    id: "e1",
    status: "BOOKED",
    submitterId: "member",
    exportClaimState: "UNCERTAIN",
    exportClaimedAt: CLAIMED_AT,
    verification: { id: "v1" },
  };
  h.updateMany.mockResolvedValue({ count: 1 });
  h.verificationUpdate.mockResolvedValue({});
  h.event.mockResolvedValue({});
});

// The lock as it was looked into, which every write must restate.
const theLock = {
  id: "e1",
  status: "BOOKED",
  exportClaimState: "UNCERTAIN",
  exportClaimedAt: CLAIMED_AT,
};
const cleared = { exportClaimedById: null, exportClaimedAt: null, exportClaimState: null };

describe("POST /api/expenses/[id]/export/resolve", () => {
  it("records a voucher that turned out to exist, as the export would have", async () => {
    const res = await resolve({ outcome: "exists", series: "a", number: 42 });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "EXPORTED", label: "A-42" });
    expect(h.verificationUpdate).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: expect.objectContaining({ fortnoxSeries: "A", fortnoxNumber: 42, fortnoxYear: null }),
    });
    expect(h.updateMany).toHaveBeenCalledWith({
      where: theLock,
      data: { status: "EXPORTED", ...cleared },
    });
    expect(h.event).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "EXPORTED", comment: "A-42" }),
    });
  });

  it("lets go of the lock when no voucher was made, and logs why", async () => {
    const res = await resolve({ outcome: "none", comment: "Sökte i serie A, inget på 318 kr" });
    expect(res.status).toBe(200);
    expect(h.updateMany).toHaveBeenCalledWith({ where: theLock, data: cleared });
    expect(h.event).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "EXPORT_RELEASED",
        comment: "Sökte i serie A, inget på 318 kr",
      }),
    });
    expect(h.verificationUpdate).not.toHaveBeenCalled();
  });

  it("will not let go without a reason", async () => {
    const res = await resolve({ outcome: "none", comment: "  " });
    expect(res.status).toBe(422);
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("is closed to a bookkeeper who may not undo exports", async () => {
    h.capabilities = ["BOOKKEEPING"];
    const res = await resolve({ outcome: "none", comment: "x" });
    expect(res.status).toBe(403);
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("refuses while the export may still answer", async () => {
    // A request in flight. Resolving it by hand under it is how a voucher
    // gets filed twice.
    h.expense = { ...h.expense, exportClaimState: "SENT", exportClaimedAt: new Date() };
    const res = await resolve({ outcome: "none", comment: "x" });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "expense.exportInProgress" });
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("has nothing to do for an utlägg that is not locked", async () => {
    h.expense = { ...h.expense, exportClaimState: null, exportClaimedAt: null };
    const res = await resolve({ outcome: "exists", series: "A", number: 1 });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "expense.nothingToResolve" });
  });

  it("lets only the first of two people resolving at once act", async () => {
    // The second one's write is conditional on a lock the first has cleared.
    h.updateMany.mockResolvedValue({ count: 0 });
    const res = await resolve({ outcome: "none", comment: "x" });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "expense.changedMeanwhile" });
    expect(h.event).not.toHaveBeenCalled();
  });
});
