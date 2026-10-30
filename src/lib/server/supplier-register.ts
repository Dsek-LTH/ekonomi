// The app's copy of Fortnox's supplier register (the Supplier model), and the
// match a document's scan is given against it. See the model for why a copy.
import "server-only";

import { prisma } from "@/lib/server/db";
import { matchSupplier } from "@/lib/domain/payment-ref";
import type { InvoiceTextFields } from "@/lib/domain/invoice-text";
import type { FortnoxSupplier } from "@/lib/fortnox";

/** The register as Fortnox just listed it, replacing what was kept. A
 *  supplier Fortnox no longer lists is dropped, since nothing points at it. */
export async function rememberRegister(list: readonly FortnoxSupplier[]): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.supplier.deleteMany({ where: { number: { notIn: list.map((s) => s.number) } } }),
    ...list.map((s) =>
      prisma.supplier.upsert({
        where: { number: s.number },
        create: { ...s, syncedAt: now },
        update: { ...s, syncedAt: now },
      }),
    ),
  ]);
}

/** One supplier just added in Fortnox, kept before the next full read. */
export async function rememberSupplier(s: FortnoxSupplier): Promise<void> {
  await prisma.supplier.upsert({ where: { number: s.number }, create: s, update: s });
}

export type KnownSupplier = { number: string; name: string };

/** A function matching a scan to the register, loaded once for a batch. */
export async function supplierMatcher(): Promise<(fields: InvoiceTextFields) => KnownSupplier | null> {
  const register = await prisma.supplier.findMany();
  return (fields) => {
    const hit = matchSupplier(fields, register);
    return hit ? { number: hit.number, name: hit.name } : null;
  };
}
