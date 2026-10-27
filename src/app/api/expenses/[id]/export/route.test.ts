import { beforeEach, describe, expect, it, vi } from "vitest";

// Filing an utlägg's voucher in Fortnox.
//
// The most consequential write in the app, and the one that cannot be undone
// over there: a voucher has no delete in the Fortnox API. So the order the two
// calls happen in is the safety, and it is an ordering no pure function can be
// asked about. What is pinned here:
//
//   the gate           only a bookkeeper, and only a BOOKED utlägg
//   the order          the attachment goes up first, because a file nobody
//                      links is harmless and a voucher nobody wanted is not
//   the rows           öre become decimal SEK, and only a cost centre Fortnox
//                      knows about travels with them
//   the failure paths  nothing local is written when Fortnox refuses, and a
//                      missing personal login is a prompt rather than a failure
//   the attach         its failure does not undo an export that worked
//   the lock           an utlägg is exported once: a second press is refused
//                      while the first holds the lock, and the lock is only
//                      let go of when it is certain no voucher was made
//
// Mocked at the boundaries: the session, the database, object storage and
// Fortnox itself. The gate, the ordering and the response are the real thing.

const h = vi.hoisted(() => ({
  capabilities: ["BOOKKEEPING"] as string[],
  /** The two-person rule's answer. See lib/server/review.ts. */
  reviewBlocker: null as "ownBooking" | null,
  status: "BOOKED" as string,
  verification: {
    id: "v1",
    date: new Date("2026-03-01"),
    description: "Kolsyra",
    lines: [
      {
        account: "4010",
        debit: 45000,
        credit: 0,
        description: "Kolsyra",
        costCenter: { code: "SEX01", source: "FORTNOX", active: true },
      },
      {
        account: "2440",
        debit: 0,
        credit: 45000,
        description: null,
        // A local cost centre: an app-side dimension Fortnox has never heard
        // of. Sending its code would have the whole voucher rejected.
        costCenter: { code: "INTERN", source: "LOCAL", active: true },
      },
    ],
  } as unknown,
  /** The order Fortnox was called in, so the test can read it back. */
  calls: [] as string[],
  createVoucher: vi.fn(),
  uploadInboxFile: vi.fn(),
  connectFile: vi.fn(),
  getUserToken: vi.fn(),
  verificationUpdate: vi.fn(),
  /** Every conditional write to the utlägg: the lock's steps and the record. */
  expenseUpdateMany: vi.fn(),
  /** Taking the lock. */
  claimWrite: vi.fn(),
  event: vi.fn(),
  // The lock as the row holds it when Exportera is pressed.
  claimState: null as string | null,
  claimedAt: null as Date | null,
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "bookkeeper",
  loadUser: async () => ({
    name: "Skattmästare",
    email: "s@dsek.se",
    studentId: "sk1234tm-s",
    roles: ["SKATTMASTARE"],
    capabilities: h.capabilities,
  }),
}));

vi.mock("@/lib/server/db", () => {
  const tx = {
    // The row read under FOR UPDATE when the lock is taken.
    $queryRaw: async () => [
      {
        status: h.status,
        exportClaimState: h.claimState,
        exportClaimedAt: h.claimedAt,
        claimer: "Kassören",
      },
    ],
    verification: { update: h.verificationUpdate },
    expense: { update: h.claimWrite, updateMany: h.expenseUpdateMany },
    expenseEvent: { create: h.event },
  };
  return {
    prisma: {
      expense: {
        findUnique: async () => ({
          id: "e1",
          status: h.status,
          reference: "DEK26-0042",
          verification: h.verification,
          receipts: [{ objectKey: "r/1", mimeType: "application/pdf" }],
        }),
        updateMany: h.expenseUpdateMany,
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

/** What each conditional write did to the lock, in order: SENT, UNCERTAIN, or
 *  "released" / "recorded" for the writes that clear it. */
const lockSteps = () =>
  h.expenseUpdateMany.mock.calls.map(([{ data }]) =>
    data.status === "EXPORTED"
      ? "recorded"
      : data.exportClaimState === null
        ? "released"
        : data.exportClaimState,
  );

class FortnoxAuthRequiredError extends Error {}
class FortnoxError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

vi.mock("@/lib/fortnox", () => ({
  getConnection: async () => ({ voucherSeries: "A" }),
  getUserToken: (...a: unknown[]) => h.getUserToken(...a),
  createVoucher: (...a: unknown[]) => {
    h.calls.push("createVoucher");
    return h.createVoucher(...a);
  },
  uploadInboxFile: (...a: unknown[]) => {
    h.calls.push("uploadInboxFile");
    return h.uploadInboxFile(...a);
  },
  connectFileToVoucher: (...a: unknown[]) => {
    h.calls.push("connectFileToVoucher");
    return h.connectFile(...a);
  },
  FortnoxAuthRequiredError,
  FortnoxError,
}));

// The cover page and the storage behind it are their own modules. What matters
// here is that something is uploaded before the voucher is made.
vi.mock("@/lib/expense/document", () => ({
  storeExpenseDocument: async () => ({
    ok: true,
    key: "cover/1",
    filename: "utlaggsrakning.pdf",
  }),
}));
vi.mock("@/lib/server/storage", () => ({
  getObjectBuffer: async () => ({ bytes: new Uint8Array([1, 2, 3]) }),
}));
vi.mock("@/lib/server/notify", () => ({
  notify: async () => 0,
  deliverSoon: () => {},
}));
vi.mock("@/lib/server/pdf-merge", () => ({
  mergeCoverAndReceipts: async (cover: Uint8Array) => ({ bytes: cover, failed: 0 }),
  PdfMergeError: class extends Error {},
}));

vi.mock("@/lib/server/review", () => ({
  exportReviewBlocker: async () => h.reviewBlocker,

}));

const { POST } = await import("./route");

const exportIt = () =>
  POST(new Request("http://test/api/expenses/e1/export", { method: "POST" }), {
    params: Promise.resolve({ id: "e1" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.calls = [];
  h.capabilities = ["BOOKKEEPING"];
  h.reviewBlocker = null;
  h.status = "BOOKED";
  h.getUserToken.mockResolvedValue("tok");
  h.uploadInboxFile.mockResolvedValue("file-1");
  h.createVoucher.mockResolvedValue({ series: "A", number: 12, year: 10 });
  h.connectFile.mockResolvedValue(undefined);
  h.verificationUpdate.mockResolvedValue({});
  h.claimWrite.mockResolvedValue({});
  h.event.mockResolvedValue({});
  h.claimState = null;
  h.claimedAt = null;
  h.expenseUpdateMany.mockImplementation(async ({ data }: { data: { exportClaimState?: string } }) => {
    if (data.exportClaimState === "SENT") h.calls.push("markSent");
    return { count: 1 };
  });
});

describe("POST /api/expenses/[id]/export", () => {
  it("refuses anybody who is not a bookkeeper", async () => {
    h.capabilities = [];
    const res = await exportIt();
    expect(res.status).toBe(403);
    expect(h.calls).toEqual([]);
  });

  it("refuses a revisor, who may read the books and not work them", async () => {
    h.capabilities = ["BOOKKEEPING_VIEW", "BUDGET_VIEW", "STOCK_VIEW", "CONTRACT_VIEW"];
    const res = await exportIt();
    expect(res.status).toBe(403);
    expect(h.calls).toEqual([]);
  });

  it("refuses whoever konterade it, before taking the lock or calling Fortnox", async () => {
    h.reviewBlocker = "ownBooking";
    const res = await exportIt();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "expense.reviewOwnBooking" });
    expect(h.calls).toEqual([]);
    expect(h.claimWrite).not.toHaveBeenCalled();
    expect(h.createVoucher).not.toHaveBeenCalled();
  });

  it("refuses an utlägg that has not been booked", async () => {
    // Exporting one that nobody has drawn a voucher for would file a voucher
    // the section never agreed to.
    for (const status of ["DRAFT", "PENDING_APPROVAL", "APPROVED", "EXPORTED"]) {
      h.status = status;
      const res = await exportIt();
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: "expense.exportOnlyBooked",
      });
    }
    expect(h.calls).toEqual([]);
  });

  it("uploads the attachment before it makes the voucher", async () => {
    // The whole ordering rule. A file sitting unused in the Fortnox inbox is
    // harmless; a voucher that should not exist cannot be deleted through the
    // API and has to be cleaned up by hand.
    const res = await exportIt();
    expect(res.status).toBe(200);
    expect(h.calls).toEqual([
      "uploadInboxFile",
      // Committed before the request goes, so a crash after it leaves a lock
      // that says a voucher may exist. See the lock tests below.
      "markSent",
      "createVoucher",
      "connectFileToVoucher",
    ]);
  });

  it("sends öre as decimal SEK, and only Fortnox's own cost centres", async () => {
    await exportIt();
    expect(h.createVoucher.mock.calls[0][1]).toMatchObject({
      series: "A",
      date: "2026-03-01",
      rows: [
        { account: 4010, debit: 450, credit: 0, costCenter: "SEX01" },
        // The local one is not sent as a cost centre. Its code goes into the
        // row text, so the row can still be told apart in Fortnox.
        { account: 2440, debit: 0, credit: 450, costCenter: undefined, description: "(INTERN)" },
      ],
    });
  });

  it("records the voucher and flips the utlägg, in one transaction", async () => {
    const res = await exportIt();
    await expect(res.json()).resolves.toMatchObject({ label: "A-12" });
    expect(h.verificationUpdate).toHaveBeenCalledWith({
      where: { id: "v1" },
      data: expect.objectContaining({
        fortnoxSeries: "A",
        fortnoxNumber: 12,
        fortnoxYear: 10,
      }),
    });
    // Conditional on the lock this export took, and letting go of it.
    expect(h.expenseUpdateMany).toHaveBeenLastCalledWith({
      where: { id: "e1", status: "BOOKED", exportClaimedAt: expect.any(Date) },
      data: {
        status: "EXPORTED",
        exportClaimedById: null,
        exportClaimedAt: null,
        exportClaimState: null,
      },
    });
    expect(h.event).toHaveBeenCalledWith({
      data: { expenseId: "e1", type: "EXPORTED", actorId: "bookkeeper", comment: "A-12" },
    });
  });

  it("writes nothing locally when Fortnox refuses the voucher", async () => {
    h.createVoucher.mockRejectedValue(new FortnoxError("Kontot finns inte", 400));
    const res = await exportIt();
    expect(res.status).toBe(400);
    // Not EXPORTED. The bookkeeper fixes the account and presses again, which
    // they can, because a refusal made no voucher and the lock was let go.
    expect(lockSteps()).toEqual(["SENT", "released"]);
    expect(h.verificationUpdate).not.toHaveBeenCalled();
  });

  it("asks for a Fortnox login rather than reporting a failure", async () => {
    // Needing to sign in is a prompt the client turns into a button.
    h.getUserToken.mockRejectedValue(new FortnoxAuthRequiredError("fortnox.loginRequired"));
    const res = await exportIt();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ needsFortnoxLogin: true });
    expect(h.calls).toEqual([]);
    expect(lockSteps()).toEqual(["released"]);
  });

  it("keeps an export that worked when only the attach failed", async () => {
    // The voucher exists by then. Undoing it is not available, and redoing the
    // export would file it twice; attaching the PDF by hand is one click.
    h.connectFile.mockRejectedValue(new Error("Timeout"));
    const res = await exportIt();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ attachWarning: "Timeout" });
    expect(lockSteps()).toEqual(["SENT", "recorded"]);
  });
});

describe("the export lock", () => {
  const ago = (ms: number) => new Date(Date.now() - ms);

  it("takes the lock before anything else", async () => {
    await exportIt();
    expect(h.claimWrite).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: {
        exportClaimedById: "bookkeeper",
        exportClaimedAt: expect.any(Date),
        exportClaimState: "CLAIMED",
      },
    });
  });

  it("refuses a second press while the first export holds it", async () => {
    // Two clicks a moment apart. The second reads the lock the first wrote.
    h.claimState = "CLAIMED";
    h.claimedAt = ago(2_000);
    const res = await exportIt();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "expense.exportInProgress",
      errorValues: { name: "Kassören" },
    });
    expect(h.calls).toEqual([]);
    expect(h.claimWrite).not.toHaveBeenCalled();
  });

  it("refuses while a voucher request is still in flight", async () => {
    h.claimState = "SENT";
    h.claimedAt = ago(60_000);
    const res = await exportIt();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "expense.exportInProgress" });
    expect(h.calls).toEqual([]);
  });

  it("refuses an utlägg whose last export ended without an answer", async () => {
    // The voucher may exist. Only a person who has looked in Fortnox may say.
    for (const [state, at] of [
      ["UNCERTAIN", ago(1_000)],
      ["SENT", ago(11 * 60_000)],
    ] as const) {
      h.claimState = state;
      h.claimedAt = at;
      const res = await exportIt();
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({ error: "expense.exportUncertain" });
    }
    expect(h.calls).toEqual([]);
  });

  it("takes over a lock abandoned before it sent anything", async () => {
    // A server that died while drawing the cover. Nothing can be in Fortnox.
    h.claimState = "CLAIMED";
    h.claimedAt = ago(6 * 60_000);
    const res = await exportIt();
    expect(res.status).toBe(200);
    expect(h.claimWrite).toHaveBeenCalled();
  });

  it("keeps the lock, uncertain, when Fortnox does not answer", async () => {
    h.createVoucher.mockRejectedValue(new TypeError("fetch failed"));
    const res = await exportIt();
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: "expense.exportUncertain" });
    expect(lockSteps()).toEqual(["SENT", "UNCERTAIN"]);
    expect(h.verificationUpdate).not.toHaveBeenCalled();
  });

  it("keeps it for a server error from Fortnox too", async () => {
    // A 5xx says nothing about whether the voucher was written before it.
    h.createVoucher.mockRejectedValue(new FortnoxError("Internal error", 503));
    const res = await exportIt();
    expect(res.status).toBe(502);
    expect(lockSteps()).toEqual(["SENT", "UNCERTAIN"]);
  });

  it("sends nothing when the lock was taken over while it waited", async () => {
    h.expenseUpdateMany.mockResolvedValueOnce({ count: 0 });
    const res = await exportIt();
    expect(res.status).toBe(409);
    expect(h.calls).not.toContain("createVoucher");
  });

  it("lets go of the lock when the upload fails, before anything was sent", async () => {
    h.uploadInboxFile.mockRejectedValue(new FortnoxError("Bad file", 400));
    const res = await exportIt();
    expect(res.status).toBe(400);
    expect(h.calls).not.toContain("createVoucher");
    expect(lockSteps()).toEqual(["released"]);
  });

  it("keeps the lock when the voucher was made but could not be recorded", async () => {
    // The worst place to fail: it exists over there and not here. The lock
    // stays so nobody files it again, and the label is handed back.
    h.verificationUpdate.mockRejectedValue(new Error("connection lost"));
    const res = await exportIt();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: "expense.exportUnrecorded",
      errorValues: { label: "A-12" },
    });
    expect(lockSteps()).toEqual(["SENT", "UNCERTAIN"]);
  });
});
