import { beforeEach, describe, expect, it, vi } from "vitest";

// Sending a document to a unit, with the due date triage read off it. Sent
// again to the unit it is already with, only the due date changes.

const h = vi.hoisted(() => ({
  update: vi.fn(),
  notify: vi.fn(),
  doc: { id: "d1", resultUnitId: null as string | null, dueDate: null, inboundMail: null },
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "kassor",
  loadUser: async () => ({ name: "Kassör", email: "k@dsek.se", studentId: "x", roles: [], capabilities: ["INVOICE_TRIAGE"] }),
}));
vi.mock("@/lib/server/db", () => {
  const db = {
    resultUnit: { findUnique: async () => ({ id: "sex", name: "Sexmästeriet" }) },
    supplierInvoiceDocument: { updateMany: h.update },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { prisma: db };
});
vi.mock("@/lib/server/notify", () => ({ notify: h.notify, deliverSoon: () => {} }));
vi.mock("@/lib/api/supplier-invoice-access", () => ({
  loadInboxDocumentFor: async () => ({ ok: true, doc: h.doc, viewer: {}, can: { canAssign: true } }),
  unitOwnersOf: async () => ["chief"],
}));

const { POST } = await import("./route");
const call = (body: object) =>
  POST(
    new Request("http://test/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "d1" }) },
  );

beforeEach(() => {
  h.doc = { id: "d1", resultUnitId: null, dueDate: null, inboundMail: null };
  for (const fn of [h.update, h.notify]) fn.mockReset();
  h.update.mockResolvedValue({ count: 1 });
});

describe("sending a document to a unit", () => {
  it("keeps the due date and tells the unit when it is due", async () => {
    expect((await call({ resultUnitId: "sex", dueDate: "2026-11-15" })).status).toBe(204);
    expect(h.update.mock.calls[0][0].data).toMatchObject({
      resultUnitId: "sex",
      dueDate: new Date("2026-11-15T00:00:00Z"),
    });
    expect(h.notify.mock.calls[0][1]).toBe("SUPPLIER_INVOICE_ASSIGNED");
  });

  it("leaves the due date alone when none is sent", async () => {
    await call({ resultUnitId: "sex" });
    expect(h.update.mock.calls[0][0].data).not.toHaveProperty("dueDate");
  });

  it("only changes the due date on one already with that unit, and mails nobody", async () => {
    h.doc = { ...h.doc, resultUnitId: "sex" };
    expect((await call({ resultUnitId: "sex", dueDate: null })).status).toBe(204);
    expect(h.update.mock.calls[0][0].data).toEqual({ dueDate: null });
    expect(h.notify).not.toHaveBeenCalled();
  });
});
