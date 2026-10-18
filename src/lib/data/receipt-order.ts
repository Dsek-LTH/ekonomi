// The one order an utlägg's documents are read in, everywhere: the panel, the
// detail page, and the merged PDF Fortnox gets. The submitter's `position`
// first; then upload order, which is all the order there was before it could
// be chosen and still settles any tie; then the id, so two stored in the same
// instant still come back the same way every time.
import type { Prisma } from "@/lib/generated/prisma/client";

export const RECEIPT_ORDER: Prisma.ReceiptOrderByWithRelationInput[] = [
  { position: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];
