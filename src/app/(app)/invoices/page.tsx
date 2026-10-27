import { requirePage } from "@/lib/server/current-user";
import { getInboxHealth, getInvoiceRows } from "@/lib/data/supplier-invoices";
import { canSeeInvoices, canTriageInvoices } from "@/lib/domain/permissions";
import { InboxClient } from "./inbox-client";
import { FocusClient } from "./focus-client";
import { focusQueue, orderedQueue } from "./queue";
import { isTreasury, loadWorkspace } from "./load";

// Leverantörsfakturor. Two shapes of the same page, by what the reader does
// with invoices:
//
//   • the treasury works a stream of them, so it gets an inbox: the list by
//     what each needs, the selected one beside it, the next one opening when
//     this one is done;
//   • a resultatansvarig has one or two to attest now and then, so they get
//     them one at a time, the PDF and the one question.
//
// Searching the history is neither, and is the archive (./arkiv).
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requirePage(canSeeInvoices);
  const { id } = await searchParams;
  const rows = await getInvoiceRows(user);

  if (isTreasury(user)) {
    const canTriage = canTriageInvoices(user.capabilities);
    // The one asked for, or the first that needs doing.
    const selectedId = id ?? orderedQueue(rows).find((r) => r.waitsOnViewer)?.id ?? null;
    const [selected, health] = await Promise.all([
      selectedId ? loadWorkspace(selectedId, user) : null,
      canTriage ? getInboxHealth() : null,
    ]);
    return (
      <InboxClient
        rows={rows}
        selected={selected}
        explicit={Boolean(id)}
        canUpload={canTriage}
        health={health}
      />
    );
  }

  const queue = focusQueue(rows);
  const currentId = id ?? queue[0]?.id ?? null;
  const current = currentId ? await loadWorkspace(currentId, user) : null;
  return <FocusClient queue={queue} current={current} />;
}
