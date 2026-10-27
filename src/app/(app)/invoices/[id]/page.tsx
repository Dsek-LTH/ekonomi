import { redirect } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { getInvoiceRows } from "@/lib/data/supplier-invoices";
import { canSeeInvoices } from "@/lib/domain/permissions";
import { FocusClient } from "../focus-client";
import { focusQueue } from "../queue";
import { isTreasury, loadWorkspace } from "../load";

// The address a mail links to. Kept as its own path because a link in a mail
// sent last week has to keep working, whichever shape the page takes now: the
// treasury goes to the inbox with this invoice open, everyone else to their
// one-at-a-time view on it.
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canSeeInvoices);
  if (isTreasury(user)) redirect(`/invoices?id=${encodeURIComponent(id)}`);

  const [rows, current] = await Promise.all([getInvoiceRows(user), loadWorkspace(id, user)]);
  return <FocusClient queue={focusQueue(rows)} current={current} />;
}
