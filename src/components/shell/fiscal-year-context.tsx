"use client";

// The räkenskapsår picked in the header, for the forms that make something
// dated: they keep to it (outsideFiscalYear in lib/ui/fiscal-year.ts). The
// shell provides it from what the layout resolved.
import { createContext, useContext } from "react";
import type { FiscalYear } from "@/lib/ui/fiscal-year";

const Ctx = createContext<FiscalYear | null>(null);

export const FiscalYearProvider = Ctx.Provider;

/** The picked year, or null before any has been synced. */
export const useFiscalYear = () => useContext(Ctx);
