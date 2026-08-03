"use client";

import { useState } from "react";
import { IconLink } from "../ui/icons";
import { cn } from "@/lib/ui/utils";

// Every Fortnox logo in the app comes from here: one reference to the asset,
// one fallback for when it isn't served. Sized by the caller so it can sit in
// the nav at icon size or inside the account badge's frame.
export function IconFortnox({ className }: { className?: string }) {
  const [missing, setMissing] = useState(false);
  // cn only joins, so a caller's size would sit alongside the default and let
  // source order pick the winner — replace it outright, as Svg does.
  const size = className ?? "size-[18px]";
  if (missing) return <IconLink className={cn(size, "shrink-0 text-muted")} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/fortnox.svg" alt="" className={size} onError={() => setMissing(true)} />
  );
}

export function FortnoxMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded",
        className,
      )}
    >
      <IconFortnox className="size-6" />
    </span>
  );
}
