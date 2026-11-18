import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock("@/lib/server/current-user", () => ({}));
vi.mock("@/lib/server/notify", () => ({ notify: h.notify }));
vi.mock("@/lib/server/expense-reference", () => ({
  claimInvoiceReference: async () => "LEV26-0007",
}));
vi.mock("@/lib/api/supplier-invoice-access", () => ({
  unitOwnersOf: async () => ["chief", "klara"],
}));

const { assignDocument } = await import("./invoice-assign");
const { StaleWrite } = await import("@/lib/api/stale-write");

const fakeTx = (docUpdated: number) => ({
  supplierInvoice: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "inv1",
      reference: data.reference,
      supplierName: null,
      invoiceNumber: null,
      amount: null,
      dueDate: data.dueDate,
    })),
  },
  supplierInvoiceDocument: { updateMany: vi.fn(async () => ({ count: docUpdated })) },
});

const arrived = new Date("2026-11-17T08:00:00Z");
const mailed = {
  id: "d1",
  createdAt: new Date("2026-11-17T09:00:00Z"),
  uploadedById: null,
  inboundMail: { id: "m1", senderId: "klara", receivedAt: arrived, subject: "Fwd: Faktura 123" },
};
const unit = { id: "sex", name: "Sexmästeriet" };

beforeEach(() => h.notify.mockReset());

describe("giving a document to a unit", () => {
  it("makes an ASSIGNED invoice with its history from when the document arrived", async () => {
    const tx = fakeTx(1);
    const due = new Date("2026-12-01T00:00:00Z");
    await assignDocument(tx as never, {
      doc: mailed,
      unit,
      actor: { id: "kassor", name: "Kassör" },
      dueDate: due,
    });
    const { data } = tx.supplierInvoice.create.mock.calls[0][0];
    expect(data).toMatchObject({
      reference: "LEV26-0007",
      status: "ASSIGNED",
      source: "EMAIL",
      receivedById: "klara",
      inboundMailId: "m1",
      resultUnitId: "sex",
      assignedById: "kassor",
      dueDate: due,
    });
    expect((data.events as { create: unknown }).create).toEqual([
      { type: "RECEIVED", actorId: "klara", createdAt: arrived },
      { type: "ASSIGNED", actorId: "kassor", diff: { from: null, to: "Sexmästeriet" } },
    ]);
    expect(tx.supplierInvoiceDocument.updateMany).toHaveBeenCalledWith({
      where: { id: "d1", invoiceId: null },
      data: { invoiceId: "inv1", position: 0, returnedFrom: null, returnNote: null },
    });
  });

  it("mails the unit's owners, named by the mail's subject, but not who gave it or forwarded it", async () => {
    await assignDocument(fakeTx(1) as never, {
      doc: mailed,
      unit,
      actor: { id: null, name: "Klara Ström" },
      dueDate: null,
      forwarderId: "klara",
    });
    const [, kind, to, email, opts] = h.notify.mock.calls[0];
    expect(kind).toBe("SUPPLIER_INVOICE_ASSIGNED");
    expect(to).toEqual(["chief", "klara"]);
    expect(opts).toEqual({ exclude: [null, "klara"] });
    expect(email.subject).toContain("Faktura 123");
    expect(email.action.url).toContain("/invoices/inv1/allocate");
  });

  it("is an upload's when there was no mail", async () => {
    const tx = fakeTx(1);
    await assignDocument(tx as never, {
      doc: { ...mailed, uploadedById: "kassor", inboundMail: null },
      unit,
      actor: { id: "kassor", name: "Kassör" },
      dueDate: null,
    });
    expect(tx.supplierInvoice.create.mock.calls[0][0].data).toMatchObject({
      source: "UPLOAD",
      receivedById: "kassor",
      inboundMailId: null,
    });
  });

  it("gives nothing that left the Inkorg a moment ago", async () => {
    await expect(
      assignDocument(fakeTx(0) as never, {
        doc: mailed,
        unit,
        actor: { id: "kassor", name: "Kassör" },
        dueDate: null,
      }),
    ).rejects.toBeInstanceOf(StaleWrite);
    expect(h.notify).not.toHaveBeenCalled();
  });
});
