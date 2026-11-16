"use client";

// Which stock the page is in. Set once by the layout of /stock/[stock], so every sheet, dialog and link under it
// knows the stock without it being passed through each of them.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { STOCKS, stockPath, type StockSlug, type StockTraits } from "@/lib/stock/stocks";
import type { DrinkCategory } from "@/lib/domain/types";

/** A product type of the stock, as the product form offers it. */
export interface StockGroupChoice {
  id: string;
  name: string;
  category: DrinkCategory | null;
}

interface StockContextValue {
  stock: StockSlug;
  traits: StockTraits;
  groups: StockGroupChoice[];
  /** A path under this stock: `href("/events")` is `/stock/alcohol/events`. */
  href: (rest?: string) => string;
}

const StockContext = createContext<StockContextValue | null>(null);

export function StockProvider({
  stock,
  groups,
  children,
}: {
  stock: StockSlug;
  groups: StockGroupChoice[];
  children: ReactNode;
}) {
  const value = useMemo<StockContextValue>(
    () => ({
      stock,
      traits: STOCKS[stock],
      groups,
      href: (rest = "") => stockPath(stock, rest),
    }),
    [stock, groups],
  );
  return <StockContext.Provider value={value}>{children}</StockContext.Provider>;
}

export function useStock(): StockContextValue {
  const value = useContext(StockContext);
  if (!value) throw new Error("useStock outside /stock/[stock]");
  return value;
}
