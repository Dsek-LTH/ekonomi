import { beforeEach, describe, expect, it, vi } from "vitest";

// Two bookkeepers booking the same utlägg. The booking screen warns about it,
// but a warning is not a guard, so what is pinned here is the server's half:
// each write carries the version its screen was built from, and a write against
// a version that is gone is a 409, whichever way the race was lost. It used to
// be a 500 from the unique index on a second booking, and a silent overwrite on
// a second amend.

const h = vi.hoisted(() => ({
  expense: null as Record<string, unknown> | null,
  updateMany: vi.fn(),
  verificationCreate: vi.fn(),
  verificationUpdate: vi.fn(),
  eventCreate: vi.fn(),
  settings: { bankAccount: "1930", memberDebtAccount: "2890" } as Record<string, string | null>,
}));

const VERSION = "2026-05-02T09:14:03.512Z";
const NEXT_VERSION = "2026-05-02T09:20:00.000Z";

// The year picked in the header is its own test (lib/api/fiscal-year.test.ts).
vi.mock("@/lib/api/fiscal-year", () => ({ denyOutsideFiscalYear: async () => null }));
vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "u1",
  loadUser: async () => ({
    name: "Skattmästaren",
    email: "s@dsek.se",
    studentId: "lu1234ge-s",
    roles: ["SKATTMASTARE"],
    capabilities: ["BOOKKEEPING"],
  }),
}));

vi.mock("@/lib/server/db", () => {
  const tx = {
    expense: {
      updateMany: h.updateMany,
      findUniqueOrThrow: async () => ({ updatedAt: new Date(NEXT_VERSION) }),
    },
    verification: { create: h.verificationCreate, update: h.verificationUpdate },
    expenseEvent: { create: h.eventCreate },
  };
  return {
    prisma: {
      expense: { findUnique: async () => h.expense },
      bookkeepingSettings: {
        findUnique: async () => h.settings,
      },
      costCenter: { findMany: async () => [] },
      project: { findMany: async () => [{ number: "12" }] },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

const { POST, PATCH } = await import("./route");

// A private outlay of 125 kr, balanced against one cost row.
const body = (over: Record<string, unknown> = {}) => ({
  expectedUpdatedAt: VERSION,
  date: "2026-05-01",
  description: "PU lu1234ge-s Kontorsmaterial",
  lines: [
    { account: "2890", accountName: "Skulder", costCenterCode: null, debit: 0, credit: 12500 },
    { account: "5010", accountName: "Kontor", costCenterCode: null, debit: 12500, credit: 0 },
  ],
  ...over,
});

const send = (handler: typeof POST, payload: unknown) =>
  handler(
    new Request("http://test/api/expenses/e1/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id: "e1" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.expense = {
    id: "e1",
    status: "APPROVED",
    paymentType: "REIMBURSEMENT",
    grossAmount: 12500,
    purchaseDate: new Date("2026-05-01"),
    title: "Kontorsmaterial",
    verification: null,
  };
  h.settings = { bankAccount: "1930", memberDebtAccount: "2890" };
  h.updateMany.mockResolvedValue({ count: 1 });
  h.verificationCreate.mockResolvedValue({});
  h.verificationUpdate.mockResolvedValue({});
  h.eventCreate.mockResolvedValue({});
});

describe("POST /api/expenses/[id]/book", () => {
  it("books against the version the screen was showing, and hands back the new one", async () => {
    const res = await send(POST, body());
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ id: "e1", updatedAt: NEXT_VERSION });
    // The condition is the whole guard: status and version, not the id alone.
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { id: "e1", status: "APPROVED", updatedAt: new Date(VERSION) },
      data: { status: "BOOKED", updatedAt: expect.any(Date) },
    });
  });

  it("is a 409 when somebody else booked it first, and writes no voucher", async () => {
    // The colleague's transaction committed while ours waited on the row lock,
    // so ours finds nothing left that matches.
    h.updateMany.mockResolvedValue({ count: 0 });
    const res = await send(POST, body());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "expense.changedMeanwhile" });
    expect(h.verificationCreate).not.toHaveBeenCalled();
    expect(h.eventCreate).not.toHaveBeenCalled();
  });

  it("is a 409, not a 500, when the voucher's unique index is what catches it", async () => {
    h.verificationCreate.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const res = await send(POST, body());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "expense.changedMeanwhile" });
    expect(h.eventCreate).not.toHaveBeenCalled();
  });

  it("refuses while the payment account is not chosen, naming the setting", async () => {
    h.settings = { bankAccount: "1930", memberDebtAccount: null };
    const res = await send(POST, body());
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ error: "settings.memberDebtAccountUnset" });
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a row on a revenue account, and writes nothing", async () => {
    const res = await send(
      POST,
      body({
        lines: [
          { account: "2890", accountName: "Skulder", debit: 0, credit: 12500 },
          { account: "3010", accountName: "Försäljning", debit: 12500, credit: 0 },
        ],
      }),
    );
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ error: "voucher.revenueAccount" });
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("stores the project a row names, and refuses one Fortnox does not have", async () => {
    const withProject = (project: string) =>
      body({
        lines: [
          { account: "2890", accountName: "Skulder", debit: 0, credit: 12500 },
          { account: "5010", accountName: "Kontor", project, debit: 12500, credit: 0 },
        ],
      });

    expect((await send(POST, withProject("12"))).status).toBe(201);
    expect(h.verificationCreate.mock.calls[0][0].data.lines.create[1]).toMatchObject({
      account: "5010",
      project: "12",
    });

    vi.clearAllMocks();
    h.updateMany.mockResolvedValue({ count: 1 });
    const res = await send(POST, withProject("99"));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ error: "voucher.unknownProject" });
  });

  it("refuses a request that does not say which version it was made against", async () => {
    const res = await send(POST, body({ expectedUpdatedAt: undefined }));
    expect(res.status).toBe(422);
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/expenses/[id]/book", () => {
  beforeEach(() => {
    h.expense = {
      ...h.expense,
      status: "BOOKED",
      verification: { date: new Date("2026-05-01"), description: "PU lu1234ge-s" },
    };
  });

  it("bumps the utlägg's version along with its voucher", async () => {
    const res = await send(PATCH, body());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: "e1", updatedAt: NEXT_VERSION });
    const [{ where, data }] = h.updateMany.mock.calls[0];
    expect(where).toEqual({ id: "e1", status: "BOOKED", updatedAt: new Date(VERSION) });
    expect(data.updatedAt).toBeInstanceOf(Date);
  });

  it("refuses to amend a voucher an export is sending", async () => {
    // The export reads these rows to send them. An amend in between would file
    // the old voucher in Fortnox and record the new one here.
    h.expense = {
      ...h.expense,
      exportClaimState: "SENT",
      exportClaimedAt: new Date(),
      exportClaimedBy: { name: "Kassören" },
    };
    const res = await send(PATCH, body());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "expense.exportInProgress",
      errorValues: { name: "Kassören" },
    });
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to amend one whose export outcome is unknown", async () => {
    h.expense = { ...h.expense, exportClaimState: "UNCERTAIN", exportClaimedAt: new Date() };
    const res = await send(PATCH, body());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "expense.exportUncertain" });
  });

  it("clears an export lock abandoned before it sent anything", async () => {
    h.expense = {
      ...h.expense,
      exportClaimState: "CLAIMED",
      exportClaimedAt: new Date(Date.now() - 6 * 60_000),
    };
    const res = await send(PATCH, body());
    expect(res.status).toBe(200);
    expect(h.updateMany.mock.calls[0][0].data).toMatchObject({
      exportClaimedById: null,
      exportClaimedAt: null,
      exportClaimState: null,
    });
  });

  it("is a 409 rather than overwriting an amend that landed first", async () => {
    h.updateMany.mockResolvedValue({ count: 0 });
    const res = await send(PATCH, body());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "expense.changedMeanwhile" });
    expect(h.verificationUpdate).not.toHaveBeenCalled();
  });
});
