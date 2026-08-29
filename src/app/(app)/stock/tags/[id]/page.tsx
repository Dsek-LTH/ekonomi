import { notFound } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getStockChanges, getStockLevels, getStockTag } from "@/lib/data/stock";
import TagClient from "./tag-client";

export default async function StockTagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canViewStock);
  const [tag, products, changes] = await Promise.all([
    getStockTag(id),
    // Levels, not just products: the sheet has to know what is on the shelf
    // before it can offer bottles to take off it.
    getStockLevels(),
    // The night in order, which is the reading the sheet cannot give: the sheet
    // shows where the figures ended up, this shows how they got there.
    getStockChanges({ tagId: id, take: 100 }),
  ]);
  if (!tag) notFound();
  return (
    <TagClient
      tag={tag}
      products={products}
      changes={changes}
      canManage={canManageStock(user.capabilities)}
    />
  );
}
