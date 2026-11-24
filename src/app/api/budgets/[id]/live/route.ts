// The open budget's live stream (server-sent events): one "change" message each time somebody
// writes to it (lib/server/budget-live.ts). The page re-reads the budget when it hears one.
import { canAccessBudget } from "@/lib/domain/permissions";
import { gate } from "@/lib/api/guard";
import { subscribeBudget } from "@/lib/server/budget-live";

export const dynamic = "force-dynamic";

// Under the usual 60s proxy read timeout, so an idle stream is not cut.
const PING_MS = 25_000;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canAccessBudget);
  if (!g.ok) return g.res;

  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(enc.encode(text));
        } catch {
          stop();
        }
      };
      // `retry`: how soon the browser reconnects after a drop.
      send("retry: 2000\n\n");
      const unsubscribe = subscribeBudget(id, () => send("data: change\n\n"));
      const ping = setInterval(() => send(": ping\n\n"), PING_MS);
      stop = () => {
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      req.signal.addEventListener("abort", () => stop());
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx (the cluster's ingress) would otherwise hold the events back in its buffer.
      "X-Accel-Buffering": "no",
    },
  });
}
