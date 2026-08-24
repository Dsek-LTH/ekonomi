import { requirePage } from "@/lib/server/current-user";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getStockTags } from "@/lib/data/stock";
import StockTagsClient from "./tags-client";

export default async function StockTagsPage() {
  const user = await requirePage(canViewStock);
  const tags = await getStockTags(200);
  return <StockTagsClient tags={tags} canManage={canManageStock(user.roles)} />;
}
