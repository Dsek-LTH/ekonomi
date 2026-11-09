"use client";

import { createContext, useContext } from "react";
import type { FiscalYear } from "@/lib/ui/fiscal-year";

const Ctx = createContext<FiscalYear | null>(null);

export const FiscalYearProvider = Ctx.Provider;

export const useFiscalYear = () => useContext(Ctx);
