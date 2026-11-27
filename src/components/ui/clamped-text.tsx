"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/utils";
import { PlainButton } from "./button";

/**
 * Text cut to two lines, with "Visa mer" under it when there is more, so the whole of it can always be read (a hover
 * title cannot be on a phone). Opened, it scrolls past a few lines rather than pushing what is beside it away.
 */
export function ClampedText({
  className,
  children,
}: {
  /** For the text itself: size, colour. */
  className?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("common.clamped");
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Measured while clamped, and again when the width changes the wrapping.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, children]);

  return (
    <div className="min-w-0">
      <p
        ref={ref}
        className={cn(
          "whitespace-pre-line break-words",
          open ? "max-h-40 overflow-y-auto" : "line-clamp-2",
          className,
        )}
      >
        {children}
      </p>
      {(overflows || open) && (
        <PlainButton
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="mt-0.5 text-xs font-medium link"
        >
          {open ? t("less") : t("more")}
        </PlainButton>
      )}
    </div>
  );
}
