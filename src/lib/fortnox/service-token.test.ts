import { beforeEach, describe, expect, it, vi } from "vitest";

// Renewing the service connection (getServiceToken): a refusal from Fortnox is
// recorded for the settings page, a hiccup is not, and a renewal that goes
// through clears what was recorded.
//
// The database and Fortnox's token endpoint are mocked. The decision about
// what counts as a refusal, and where it is written, is the real one.

const h = vi.hoisted(() => ({
  conn: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  recorded: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/server/secrets", () => ({
  encryptSecret: (s: string) => s,
  decryptSecret: (s: string) => s,
}));

vi.mock("@/lib/server/db", () => {
  const tx = {
    $executeRaw: async () => 1,
    fortnoxConnection: {
      findUnique: async () => h.conn,
      update: async (args: { data: Record<string, unknown> }) => h.updates.push(args.data),
    },
  };
  return {
    prisma: {
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      fortnoxConnection: {
        findFirst: async () => h.conn,
        updateMany: async (args: { data: Record<string, unknown> }) => {
          h.recorded.push(args.data);
          return { count: 1 };
        },
      },
    },
  };
});

process.env.FORTNOX_CLIENT_ID = "client";
process.env.FORTNOX_CLIENT_SECRET = "secret";
process.env.FORTNOX_REDIRECT_URI = "http://localhost/api/fortnox/callback";

const { getServiceToken } = await import("./index");

const answer = (status: number, body: object) =>
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  h.conn = {
    id: "conn",
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: new Date(Date.now() - 60_000),
    scopes: "bookkeeping",
  };
  h.updates = [];
  h.recorded = [];
});

describe("getServiceToken", () => {
  it("records a refresh Fortnox refuses, and still fails", async () => {
    answer(400, { error: "invalid_grant", error_description: "Invalid refresh token" });
    await expect(getServiceToken()).rejects.toThrow("Invalid refresh token");
    expect(h.recorded).toEqual([
      { refreshFailedAt: expect.any(Date), refreshError: "Invalid refresh token" },
    ]);
    expect(h.updates).toEqual([]);
  });

  it("records nothing when Fortnox is merely down", async () => {
    answer(503, {});
    await expect(getServiceToken()).rejects.toThrow();
    expect(h.recorded).toEqual([]);
  });

  it("clears a recorded failure once a refresh goes through", async () => {
    answer(200, { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, scope: "" });
    expect(await getServiceToken()).toBe("new-access");
    expect(h.updates).toEqual([
      expect.objectContaining({ refreshToken: "new-refresh", refreshFailedAt: null, refreshError: null }),
    ]);
  });

  it("does not refresh a token that is still fresh", async () => {
    h.conn.expiresAt = new Date(Date.now() + 30 * 60_000);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await getServiceToken()).toBe("old-access");
    expect(fetch).not.toHaveBeenCalled();
  });
});
