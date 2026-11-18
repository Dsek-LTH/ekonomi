import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  assign: vi.fn(),
  offYear: null as Response | null,
  can: { canAssign: true },
  doc: { id: "d1", createdAt: new Date(), uploadedById: null, inboundMail: null },
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "kassor",
  loadUser: async () => ({
    name: "Kassör",
    email: "k@dsek.se",
    studentId: "x",
    roles: [],
    capabilities: ["INVOICE_TRIAGE"],
  }),
}));
vi.mock("@/lib/server/db", () => {
  const db = {
    resultUnit: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "sex" ? { id: "sex", name: "Sexmästeriet" } : null,
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { prisma: db };
});
vi.mock("@/lib/server/notify", () => ({ deliverSoon: () => {} }));
vi.mock("@/lib/server/invoice-assign", () => ({ assignDocument: h.assign }));
vi.mock("@/lib/server/expense-reference", () => ({
  withReferenceRetry: <T>(work: () => Promise<T>) => work(),
}));
vi.mock("@/lib/api/fiscal-year", () => ({ denyOutsideFiscalYear: async () => h.offYear }));
vi.mock("@/lib/api/supplier-invoice-access", () => ({
  loadInboxDocumentFor: async () => ({ ok: true, doc: h.doc, viewer: {}, can: h.can }),
}));

const { POST } = await import("./route");
const call = (body: object) =>
  POST(
    new Request("http://test/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "d1" }) },
  );

beforeEach(() => {
  h.assign.mockReset();
  h.assign.mockResolvedValue({ id: "inv1" });
  h.offYear = null;
  h.can = { canAssign: true };
});

describe("sending a document to a unit", () => {
  it("makes the invoice, with the due date triage read", async () => {
    const res = await call({ resultUnitId: "sex", dueDate: "2026-11-15" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "inv1" });
    expect(h.assign.mock.calls[0][1]).toMatchObject({
      doc: h.doc,
      unit: { id: "sex", name: "Sexmästeriet" },
      actor: { id: "kassor", name: "Kassör" },
      dueDate: new Date("2026-11-15T00:00:00Z"),
    });
  });

  it("makes it with no due date when none is sent", async () => {
    await call({ resultUnitId: "sex" });
    expect(h.assign.mock.calls[0][1].dueDate).toBeNull();
  });

  it("refuses an unknown unit", async () => {
    expect((await call({ resultUnitId: "nope" })).status).toBe(422);
    expect(h.assign).not.toHaveBeenCalled();
  });

  it("refuses somebody who is not triage", async () => {
    h.can = { canAssign: false };
    expect((await call({ resultUnitId: "sex" })).status).toBe(403);
  });

  it("makes nothing while another räkenskapsår is picked", async () => {
    h.offYear = new Response(null, { status: 409 });
    expect((await call({ resultUnitId: "sex" })).status).toBe(409);
    expect(h.assign).not.toHaveBeenCalled();
  });
});
