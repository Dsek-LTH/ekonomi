"use client";

import { useState } from "react";
import { IconLink } from "../ui/icons";
import { cn } from "@/lib/ui/utils";

export function IconFortnox({ className }: { className?: string }) {
  const [missing, setMissing] = useState(false);
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
      className={cn("flex size-8 shrink-0 items-center justify-center rounded-control", className)}
    >
      <IconFortnox className="size-6" />
    </span>
  );
}
