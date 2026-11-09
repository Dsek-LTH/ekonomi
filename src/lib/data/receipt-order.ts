// Position first, then upload order, then id, so ties always come back the same way.
import type { Prisma } from "@/lib/generated/prisma/client";

export const RECEIPT_ORDER: Prisma.ReceiptOrderByWithRelationInput[] = [
  { position: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];
