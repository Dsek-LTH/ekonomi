import "server-only";

// Writing the trail of how a stock is booked (StockSettingsChange): one row per field that actually changed.
import type { TxClient } from "./tx";

const asText = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);

/** `before` is the row as it stood, `patch` what was asked for. A field absent from the patch was not touched. */
export async function recordSettingsChanges(
  tx: TxClient,
  args: {
    stockId: string;
    groupName?: string;
    actorId: string;
    before: Record<string, unknown>;
    patch: Record<string, unknown>;
  },
): Promise<void> {
  const rows = Object.entries(args.patch).flatMap(([field, next]) => {
    if (next === undefined) return [];
    const fromValue = asText(args.before[field]);
    const toValue = asText(next);
    return fromValue === toValue ? [] : [{ field, fromValue, toValue }];
  });
  if (rows.length === 0) return;
  await tx.stockSettingsChange.createMany({
    data: rows.map((r) => ({
      ...r,
      stockId: args.stockId,
      groupName: args.groupName ?? null,
      actorId: args.actorId,
    })),
  });
}

/** Whether every account named is in the synced chart. Null and undefined pass: they name none. */
export async function unknownAccount(
  tx: TxClient,
  accounts: readonly (string | null | undefined)[],
): Promise<string | null> {
  const named = [...new Set(accounts.filter((a): a is string => Boolean(a)))];
  if (named.length === 0) return null;
  const found = await tx.account.findMany({
    where: { number: { in: named } },
    select: { number: true },
  });
  const known = new Set(found.map((a) => a.number));
  return named.find((a) => !known.has(a)) ?? null;
}
