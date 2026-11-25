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

// One line, clipped: a title with no spaces in it (a pasted reference, a run of letters) would
// otherwise run out past the page's buttons. The whole of a plain title is on hover. Clipped
// sideways only, with room for a focus ring (CLIP_LINE), since a title edited in place
// (EditableText) draws a box and ring past the text.
export const CLIP_LINE =
  "overflow-x-clip [overflow-clip-margin:4px] text-ellipsis whitespace-nowrap";

export function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <TitleOrBar
      page={
        <h1
          className={`${CLIP_LINE} text-xl font-semibold tracking-tight`}
          title={typeof children === "string" ? children : undefined}
        >
          {children}
        </h1>
      }
      bar={<h1 className="truncate text-base font-semibold">{children}</h1>}
    />
  );
}
