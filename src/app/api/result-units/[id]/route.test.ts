import { beforeEach, describe, expect, it, vi } from "vitest";

// Renaming a result unit, and the thing about it that is easy to get wrong
// twice: resultatansvar is held by *name*. User.resultUnits is a String[], not
// a foreign key, so a rename that touches only this row leaves every
// resultatansvarig answering for a string that no longer resolves. Their attest
// queue empties, nothing is logged, and nothing anywhere says why.
//
// It was got wrong once already: the delete handler guards this carefully and
// the rename did not. So the carrying-over is pinned here rather than left to
// whoever reads the route next.

const h = vi.hoisted(() => ({
  unit: null as { id: string; name: string } | null,
  clash: null as { id: string; name: string } | null,
  capabilities: ["SETTINGS"] as string[],
  update: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  resolveUserId: async () => "u1",
  loadUser: async () => ({
    name: "Skattmästaren",
    email: "s@dsek.se",
    studentId: "lu1234ge-s",
    roles: ["SKATTMASTARE"],
    capabilities: h.capabilities,
  }),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    resultUnit: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; name?: string } }) =>
        where.id ? h.unit : h.clash,
      ),
    },
  },
}));

vi.mock("@/lib/server/tx", () => ({
  serializable: async (fn: (t: unknown) => Promise<unknown>) =>
    fn({
      resultUnit: { update: h.update },
      $executeRaw: h.executeRaw,
    }),
}));

const { PATCH } = await import("./route");

const patch = (name: string) =>
  PATCH(
    new Request("http://test/api/result-units/ru1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
    { params: Promise.resolve({ id: "ru1" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.unit = { id: "ru1", name: "Källarmästeriet" };
  h.clash = null;
  h.capabilities = ["SETTINGS"];
  h.update.mockImplementation(async () => ({ id: "ru1", name: "Källarmästeriet" }));
});

describe("PATCH /api/result-units/[id]", () => {
  it("carries the rename onto everyone who holds the unit by name", async () => {
    const res = await patch("Källarmästeriet KM");
    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledWith({
      where: { id: "ru1" },
      data: { name: "Källarmästeriet KM" },
    });

    // The array rewrite is the whole point of the handler. Asserted through the
    // tagged template's own arguments: the values arrive as bound parameters,
    // never interpolated into the statement.
    expect(h.executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = h.executeRaw.mock.calls[0];
    expect(strings.join("?")).toContain("array_replace");
    expect(values).toEqual(["Källarmästeriet", "Källarmästeriet KM", "Källarmästeriet"]);
  });

  it("does nothing at all when the name has not actually changed", async () => {
    // Not merely harmless to skip: rewriting every holder's array for a no-op
    // is a table-wide write nobody asked for.
    const res = await patch("Källarmästeriet");
    expect(res.status).toBe(200);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.executeRaw).not.toHaveBeenCalled();
  });

  it("refuses a name another result unit already has", async () => {
    h.clash = { id: "ru2", name: "Sexmästeriet" };
    const res = await patch("Sexmästeriet");
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "resultUnit.exists" });
    expect(h.executeRaw).not.toHaveBeenCalled();
  });

  it("is a 404 for a unit that is not there, not a 500 from the driver", async () => {
    h.unit = null;
    const res = await patch("Vad som helst");
    expect(res.status).toBe(404);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("is closed to somebody who may not reach settings", async () => {
    h.capabilities = ["BUDGET_VIEW"];
    const res = await patch("Något annat");
    expect(res.status).toBe(403);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.executeRaw).not.toHaveBeenCalled();
  });
});
