import { beforeEach, describe, expect, it, vi } from "vitest";

// What one forwarded mail becomes, and how the sync moves through the mailbox.
//
// Gmail, storage and the database are mocked; the rules in between (who may
// send, what the note says, whose the invoice is) are the real ones from
// lib/domain/inbound-mail.ts, and what is checked is what gets written.

const PDF = Buffer.from("%PDF-1.4\n%fake\n");
const GIF = Buffer.from("GIF89a....");

const h = vi.hoisted(() => ({
  message: {} as Record<string, unknown>,
  attachments: {} as Record<string, Buffer>,
  history: { ids: [] as string[], historyId: "200" } as { ids: string[]; historyId: string } | "gone",
  recent: [] as string[],
  existing: new Set<string>(),
  claimFails: false,
  invoiceCreate: vi.fn(),
  mailCreate: vi.fn(),
  mailDelete: vi.fn(),
  syncUpdate: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  notify: vi.fn(),
  getMessage: vi.fn(),
  sender: { id: "klara", name: "Klara Ström", roles: ["RESULTATANSVARIG"] } as object | null,
  owned: ["Sexmästeriet"] as string[],
}));

vi.mock("./gmail", () => {
  class GmailError extends Error {
    constructor(
      message: string,
      readonly status?: number,
    ) {
      super(message);
    }
  }
  return {
    GmailError,
    gmailConfig: () => ({ allowedDomain: "dsek.se" }),
    getMessage: h.getMessage,
    getAttachment: async (_c: unknown, _m: string, id: string) => h.attachments[id],
    messagesAddedSince: async () => {
      if (h.history === "gone") throw new GmailError("too old", 404);
      return h.history;
    },
    recentMessages: async () => h.recent,
    currentHistoryId: async () => "999",
    watch: async () => ({ historyId: "1", expiration: new Date() }),
  };
});

vi.mock("@/lib/server/db", () => ({
  prisma: {
    inboundMail: {
      findUnique: async ({ where }: { where: { gmailId: string } }) =>
        h.existing.has(where.gmailId) ? { id: "seen" } : null,
      create: async (args: unknown) => {
        h.mailCreate(args);
        if (h.claimFails) throw Object.assign(new Error("unique"), { code: "P2002" });
        return { id: "mail1" };
      },
      delete: h.mailDelete,
    },
    user: {
      findFirst: async () => h.sender,
      findMany: async () => [{ id: "chief" }],
    },
    resultUnit: {
      findMany: async () => [
        { id: "sex", name: "Sexmästeriet" },
        { id: "cafe", name: "Caféutskottet" },
      ],
    },
    costCenter: { findMany: async () => [{ code: "SEX01" }, { code: "CAFE01" }] },
    gmailSync: {
      upsert: async () => ({ historyId: "100" }),
      update: h.syncUpdate,
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ supplierInvoice: { create: h.invoiceCreate } }),
  },
}));

vi.mock("@/lib/server/storage", () => ({
  putObject: h.put,
  deleteObjectBestEffort: h.del,
  supplierInvoiceDocumentKey: (i: string, d: string, f: string) => `supplier-invoices/${i}/${d}-${f}`,
}));

vi.mock("@/lib/server/result-units", () => ({
  getPrefixes: async () => [
    { value: "SEX", resultUnitId: "sex", resultUnitName: "Sexmästeriet" },
    { value: "CAFE", resultUnitId: "cafe", resultUnitName: "Caféutskottet" },
  ],
  resultUnitForCode: (code: string) =>
    code.startsWith("SEX")
      ? { resultUnitId: "sex", resultUnitName: "Sexmästeriet" }
      : code.startsWith("CAFE")
        ? { resultUnitId: "cafe", resultUnitName: "Caféutskottet" }
        : null,
  ownedResultUnits: async () => ({ names: h.owned, prefixes: [] }),
}));

vi.mock("@/lib/server/notify", () => ({ notify: h.notify, deliverSoon: () => {} }));

const { syncInbox } = await import("./inbound-mail");

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const PASS = "mx.google.com; dkim=pass header.i=@dsek.se; dmarc=pass header.from=dsek.se";

function mail(opts: {
  from?: string;
  auth?: string;
  text?: string;
  attachments?: { name: string; id: string; bytes: Buffer; type?: string }[];
}) {
  for (const a of opts.attachments ?? []) h.attachments[a.id] = a.bytes;
  return {
    id: "g1",
    internalDate: "1793000000000",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: opts.from ?? "Klara Ström <klara@dsek.se>" },
        { name: "Subject", value: "Fwd: Faktura 20417" },
        { name: "Authentication-Results", value: opts.auth ?? PASS },
        { name: "Message-ID", value: "<abc@mail.gmail.com>" },
      ],
      parts: [
        { mimeType: "text/plain", body: { data: b64(opts.text ?? "") } },
        ...(opts.attachments ?? []).map((a) => ({
          mimeType: a.type ?? "application/pdf",
          filename: a.name,
          body: { attachmentId: a.id, size: a.bytes.length },
        })),
      ],
    },
  };
}

beforeEach(() => {
  h.history = { ids: ["g1"], historyId: "200" };
  h.recent = [];
  h.existing = new Set();
  h.claimFails = false;
  h.sender = { id: "klara", name: "Klara Ström", roles: ["RESULTATANSVARIG"] };
  h.owned = ["Sexmästeriet"];
  for (const fn of [h.invoiceCreate, h.mailCreate, h.mailDelete, h.syncUpdate, h.put, h.del, h.notify, h.getMessage]) {
    fn.mockReset();
  }
  h.mailDelete.mockResolvedValue({});
  h.getMessage.mockImplementation(async () => mail({ attachments: [{ name: "faktura.pdf", id: "a1", bytes: PDF }] }));
});

const created = () => h.invoiceCreate.mock.calls.map((c) => c[0].data);

describe("one mail", () => {
  it("refuses mail from outside dsek.se and makes no invoice", async () => {
    h.getMessage.mockResolvedValue(mail({ from: "faktura@lundsslap.se", attachments: [{ name: "f.pdf", id: "a1", bytes: PDF }] }));
    expect(await syncInbox()).toEqual({ accepted: 0, rejected: 1, skipped: 0 });
    expect(h.mailCreate.mock.calls[0][0].data).toMatchObject({ status: "REJECTED", rejectReason: "foreignDomain" });
    expect(h.invoiceCreate).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  });

  it("refuses a dsek.se From that did not authenticate", async () => {
    h.getMessage.mockResolvedValue(mail({ auth: "mx.google.com; dkim=fail; dmarc=fail header.from=dsek.se" }));
    await syncInbox();
    expect(h.mailCreate.mock.calls[0][0].data.rejectReason).toBe("notAuthenticated");
    expect(h.invoiceCreate).not.toHaveBeenCalled();
  });

  it("makes one invoice per PDF, and leaves out what only claims to be one", async () => {
    h.owned = [];
    h.getMessage.mockResolvedValue(
      mail({
        attachments: [
          { name: "faktura.pdf", id: "a1", bytes: PDF },
          { name: "specifikation.pdf", id: "a2", bytes: PDF },
          { name: "logo.pdf", id: "a3", bytes: GIF },
          { name: "bild.png", id: "a4", bytes: GIF, type: "image/png" },
        ],
      }),
    );
    expect(await syncInbox()).toEqual({ accepted: 1, rejected: 0, skipped: 0 });
    expect(h.put).toHaveBeenCalledTimes(2);
    expect(created()).toHaveLength(2);
    expect(created()[0]).toMatchObject({
      source: "EMAIL",
      status: "INBOX",
      receivedById: "klara",
      inboundMailId: "mail1",
      description: "Faktura 20417",
    });
    expect(created()[0].documents.create.filename).toBe("faktura.pdf");
  });

  it("still makes an invoice for a mail without a PDF, to be completed by hand", async () => {
    h.owned = [];
    h.getMessage.mockResolvedValue(mail({ text: "Länk till fakturan: https://..." }));
    await syncInbox();
    expect(created()).toHaveLength(1);
    expect(created()[0].documents).toBeUndefined();
  });

  it("gives it to the unit a cost centre code in the note belongs to, and says why", async () => {
    h.owned = ["Sexmästeriet", "Caféutskottet"];
    h.getMessage.mockResolvedValue(
      mail({
        text: "Till CAFE01 tack\n\n---------- Forwarded message ---------\nFrom: Grossisten <order@grossisten.se>\n",
        attachments: [{ name: "f.pdf", id: "a1", bytes: PDF }],
      }),
    );
    await syncInbox();
    expect(h.mailCreate.mock.calls[0][0].data).toMatchObject({
      note: "Till CAFE01 tack",
      originalFrom: "order@grossisten.se",
    });
    expect(created()[0]).toMatchObject({ status: "ASSIGNED", resultUnitId: "cafe" });
    expect(created()[0].events.create[1]).toMatchObject({
      type: "ASSIGNED",
      diff: { from: null, to: "Caféutskottet", auto: "costCenter", match: "CAFE01" },
    });
    expect(h.notify).toHaveBeenCalledWith(
      expect.anything(),
      "SUPPLIER_INVOICE_ASSIGNED",
      ["chief"],
      expect.anything(),
      { exclude: ["klara"] },
    );
  });

  it("falls back to the forwarder's one unit", async () => {
    await syncInbox();
    expect(created()[0]).toMatchObject({ status: "ASSIGNED", resultUnitId: "sex" });
  });

  it("skips a mail it has already read without asking Gmail for it", async () => {
    h.existing.add("g1");
    expect(await syncInbox()).toEqual({ accepted: 0, rejected: 0, skipped: 1 });
    expect(h.getMessage).not.toHaveBeenCalled();
  });

  it("leaves a mail to whoever claimed it first", async () => {
    h.claimFails = true;
    expect(await syncInbox()).toEqual({ accepted: 0, rejected: 0, skipped: 1 });
    expect(h.put).not.toHaveBeenCalled();
  });

  it("undoes the claim and the stored files when the invoices cannot be written", async () => {
    h.invoiceCreate.mockRejectedValue(new Error("db down"));
    await expect(syncInbox()).rejects.toThrow("db down");
    expect(h.del).toHaveBeenCalledTimes(1);
    expect(h.mailDelete).toHaveBeenCalledWith({ where: { id: "mail1" } });
  });
});

describe("the sync", () => {
  it("moves the history id on once everything is read", async () => {
    await syncInbox();
    expect(h.syncUpdate).toHaveBeenLastCalledWith({
      where: { id: "singleton" },
      data: expect.objectContaining({ historyId: "200", lastError: null }),
    });
  });

  it("does not move it past a mail that failed, and records why", async () => {
    h.getMessage.mockRejectedValue(new Error("Gmail is down"));
    await expect(syncInbox()).rejects.toThrow();
    expect(h.syncUpdate).toHaveBeenCalledTimes(1);
    expect(h.syncUpdate.mock.calls[0][0].data).toEqual({ lastError: "Gmail is down" });
  });

  it("lists the last week instead when Gmail's history has run out", async () => {
    h.history = "gone";
    h.recent = ["g1"];
    expect(await syncInbox()).toMatchObject({ accepted: 1 });
    expect(h.syncUpdate.mock.calls.at(-1)![0].data.historyId).toBe("999");
  });
});
