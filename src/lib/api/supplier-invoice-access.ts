// The first lines of every levfaktura route: find the invoice the way the
// viewer is allowed to see it, and work out what they may do with it.
//
// One loader so that every route asks the visibility question the same way the
// page did (lib/data/supplier-invoices.ts). An invoice outside the viewer's
// scope is a 404, not a 403, for the reason it is everywhere else in the app:
// whether it exists at all is not their business.
import "server-only";

import type { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, type Actor } from "@/lib/api/guard";
import {
  invoiceFactsOf,
  invoiceScopeWhere,
  invoiceViewerOf,
  type InvoiceViewerCtx,
} from "@/lib/data/supplier-invoices";
import { invoiceCapabilities, type InvoiceCapabilities } from "@/lib/domain/supplier-invoice";

const INCLUDE = {
  resultUnit: { select: { name: true } },
  allocations: {
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
    include: { costCenter: { select: { code: true, name: true } } },
  },
  _count: { select: { documents: true } },
};

async function find(id: string, v: InvoiceViewerCtx) {
  return prisma.supplierInvoice.findFirst({
    where: { AND: [{ id }, invoiceScopeWhere(v)] },
    include: INCLUDE,
  });
}

export type LoadedInvoice = NonNullable<Awaited<ReturnType<typeof find>>>;

export type InvoiceAccess =
  | {
      ok: true;
      invoice: LoadedInvoice;
      viewer: InvoiceViewerCtx;
      /** Per allocation, in the invoice's order: whether this actor may sign it. */
      mayAttest: boolean[];
      can: InvoiceCapabilities;
    }
  | { ok: false; res: NextResponse };

export async function loadInvoiceFor(actor: Actor, id: string): Promise<InvoiceAccess> {
  const viewer = await invoiceViewerOf(actor);
  const invoice = await find(id, viewer);
  if (!invoice) return { ok: false, res: fail(404, "supplierInvoice.notFound") };
  const facts = invoiceFactsOf(viewer, invoice);
  return {
    ok: true,
    invoice,
    viewer,
    mayAttest: facts.allocations.map((a) => a.viewerMayAttest),
    can: invoiceCapabilities(viewer, facts),
  };
}

/** The refusal for a change the actor may not make to this invoice: a 409 when
 *  it is the invoice's state that stands in the way, a 403 when it is them. */
export function refuseChange(invoice: { status: string }, stateAllows: boolean): NextResponse {
  return stateAllows
    ? fail(403, "supplierInvoice.denied")
    : fail(409, "supplierInvoice.notChangeableInStatus", {
        values: { status: { key: `common.invoiceStatus.${invoice.status}` } },
      });
}

/** Every active resultatansvarig for a unit, by its name, which is what
 *  User.resultUnits holds. Who an assigned invoice's mail goes to. */
export async function unitOwnersOf(unitName: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { active: true, roles: { has: "RESULTATANSVARIG" }, resultUnits: { has: unitName } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
