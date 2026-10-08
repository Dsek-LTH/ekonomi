"use client";

import { createContext, useContext } from "react";
import { createPortal } from "react-dom";

// Where a page's title goes when the page is a settings section.
//
// Inside the settings overlay the top bar was a strip holding only the close
// button, and the section's own heading started under it, level with nothing.
// So the overlay hands down the bar's title element, and the heading is drawn
// there instead. Outside the overlay there is no provider, and the heading is
// the page's own, where it always was.
//
// `undefined` is "not in the overlay". `null` is "in it, before the bar has
// mounted", which draws nothing rather than a heading that would then jump.
export const SettingsTitleSlot = createContext<HTMLElement | null | undefined>(undefined);

/** `page` where there is no overlay, `bar` in the overlay's top bar. */
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
