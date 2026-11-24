// Live budget edits: a write announces "this budget changed" through Postgres NOTIFY, and every
// app process passes it on to the browsers that have that budget open (the SSE stream in
// app/api/budgets/[id]/live). Through the database, not process memory, so it holds however
// many replicas run. The signal carries only the budget id: a browser that hears it re-reads
// the budget (an ETag makes that cheap), so nothing it misses can leave it wrong for long.
import "server-only";

import { after } from "next/server";
import { Client } from "pg";
import { prisma } from "./db";
import { serverEnv } from "./env";

const CHANNEL = "budget_changed";
const RETRY_MS = 2_000;

type Listener = () => void;

interface State {
  subscribers: Map<string, Set<Listener>>;
  client: Client | null;
  connecting: Promise<void> | null;
  /** A connection has been up before, so a new one may have missed notifications. */
  wasUp: boolean;
}

// On globalThis so a dev hot reload does not open a second LISTEN connection.
const g = globalThis as unknown as { budgetLive?: State };
const state: State = (g.budgetLive ??= {
  subscribers: new Map(),
  client: null,
  connecting: null,
  wasUp: false,
});

function tellAll() {
  for (const set of state.subscribers.values()) for (const fn of set) fn();
}

// One LISTEN connection per process, opened with the first subscriber. When it drops, it
// comes back while anybody is still listening, and everybody re-reads, since a notification
// sent in between was lost.
function connect(): Promise<void> {
  if (state.client || state.connecting) return state.connecting ?? Promise.resolve();
  const client = new Client({ connectionString: serverEnv("DATABASE_URL") });
  const lost = () => {
    if (state.client !== client) return;
    state.client = null;
    client.removeAllListeners();
    void client.end().catch(() => {});
    if (state.subscribers.size > 0) setTimeout(() => void connect(), RETRY_MS);
  };
  state.connecting = (async () => {
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      client.on("notification", (msg) => {
        if (msg.channel !== CHANNEL || !msg.payload) return;
        for (const fn of state.subscribers.get(msg.payload) ?? []) fn();
      });
      client.on("error", lost);
      client.on("end", lost);
      state.client = client;
      if (state.wasUp) tellAll();
      state.wasUp = true;
    } catch {
      void client.end().catch(() => {});
      if (state.subscribers.size > 0) setTimeout(() => void connect(), RETRY_MS);
    } finally {
      state.connecting = null;
    }
  })();
  return state.connecting;
}

/** Calls `fn` whenever `budgetId` changes. Returns the unsubscribe. */
export function subscribeBudget(budgetId: string, fn: Listener): () => void {
  let set = state.subscribers.get(budgetId);
  if (!set) state.subscribers.set(budgetId, (set = new Set()));
  set.add(fn);
  void connect();
  return () => {
    set.delete(fn);
    if (set.size === 0) state.subscribers.delete(budgetId);
  };
}

/**
 * Announces a change to `budgetId` once the response is sent, so after the route's write has
 * committed. Also after a refused write, which costs a re-read that finds nothing new.
 */
export function announceBudgetChange(budgetId: string): void {
  after(async () => {
    try {
      await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${budgetId})`;
    } catch {
      // The editors' safety-net poll picks the change up instead.
    }
  });
}
