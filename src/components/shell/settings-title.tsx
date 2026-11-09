"use client";

import { createContext, useContext } from "react";
import { createPortal } from "react-dom";

export const SettingsTitleSlot = createContext<HTMLElement | null | undefined>(undefined);

export function TitleOrBar({ page, bar }: { page: React.ReactNode; bar: React.ReactNode }) {
  const slot = useContext(SettingsTitleSlot);
  if (slot === undefined) return page;
  if (!slot) return null;
  return createPortal(bar, slot);
}

export function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <TitleOrBar
      page={<h1 className="text-2xl font-semibold tracking-tight">{children}</h1>}
      bar={<h1 className="truncate text-base font-semibold">{children}</h1>}
    />
  );
}
