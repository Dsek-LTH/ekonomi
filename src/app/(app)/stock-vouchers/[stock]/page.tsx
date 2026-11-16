import { notFound, redirect } from "next/navigation";
import { isStockSlug, stockPath } from "@/lib/stock/stocks";

// Lagervärde moved into each stock, as its Bokföring page. Old links land there.
export default async function StockVouchersRedirect({
  params,
}: {
  params: Promise<{ stock: string }>;
}) {
  const { stock } = await params;
  if (!isStockSlug(stock)) notFound();
  redirect(stockPath(stock, "/bookkeeping"));
}
