import type { ReactNode } from "react";
import { StockProvider } from "@/components/stock/stock-context";
import { getStockGroups } from "@/lib/data/stock";
import { requireStockPage } from "@/lib/server/stock-page";

// Every page of one stock. The segment is checked here and again by each page, which is what picks the capability
// the page needs: a layout does not re-render on navigation between its pages.
export default async function StockLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ stock: string }>;
}) {
  const { stock } = await requireStockPage(params, "enter");
  return (
    <StockProvider stock={stock} groups={await getStockGroups(stock)}>
      {children}
    </StockProvider>
  );
}
