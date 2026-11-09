"use client";

// A product's shelf drawn as bottles: a full one with its count for sealed, each opened bottle filled to its level.
// A UNIT product is its count, nothing to draw.
import { useId } from "react";
import { useTranslations } from "next-intl";
import { LEVELS, bottlesAt, type OpenBottles } from "@/lib/stock/levels";
import { cn } from "@/lib/ui/utils";

/** Past this many open bottles the rest are a count, not more drawings. */
const MAX_OPEN = 4;

export function BottleLevels({
  kind,
  sealed,
  open,
  size = "sm",
}: {
  kind: "UNIT" | "VOLUME";
  sealed: number;
  open: OpenBottles;
  size?: "sm" | "lg";
}) {
  const t = useTranslations("stock");
  const big = size === "lg";

  if (kind === "UNIT") {
    return (
      <span
        className={cn(
          "tabular-nums",
          big ? "text-2xl font-semibold" : "",
          sealed === 0 && "text-muted",
        )}
      >
        {t("holding.unit", { units: sealed })}
      </span>
    );
  }

  const levels = LEVELS.flatMap((l) => Array.from({ length: bottlesAt(open, l) }, () => l));
  const shown = levels.slice(0, MAX_OPEN);
  const more = levels.length - shown.length;
  const label = t("holding.volume", { sealed, open: levels.length });

  return (
    <span role="img" aria-label={label} title={label} className="inline-flex items-center gap-1.5">
      <span className={cn("inline-flex items-center gap-0.5", sealed === 0 && "opacity-40")}>
        <Bottle level={100} big={big} />
        <span
          className={cn("tabular-nums", big ? "text-2xl font-semibold leading-none" : "text-sm")}
        >
          {sealed}
        </span>
      </span>
      {shown.length > 0 && (
        <span className="inline-flex items-center gap-px border-l border-border pl-1.5">
          {shown.map((l, i) => (
            <Bottle key={i} level={l} big={big} />
          ))}
          {more > 0 && <span className="text-xs text-muted tabular-nums">+{more}</span>}
        </span>
      )}
    </span>
  );
}

/** One bottle filled to `level` per cent, in the app's icon style (24-unit box, 1.6 stroke, muted ink). Also marks a spirit's ladder rungs on the event sheet. */
const BODY =
  "M10.5 5.9l-2.6 2.6A2 2 0 0 0 7.3 9.9V20a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5V9.9a2 2 0 0 0-.6-1.4l-2.6-2.6z";

export function Bottle({ level, big = false }: { level: number; big?: boolean }) {
  // The body's inside runs from y 5.9 to 20.7 and the level is measured over that, shoulder included.
  // The liquid continues under the stroke to 21.5, and the neck is never filled.
  const top = 5.9;
  const inner = 20.7;
  const bottom = 21.5;
  const fill = level > 0 ? ((inner - top) * level) / 100 + (bottom - inner) : 0;
  const clip = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0 text-muted", big ? "size-8" : "size-[18px]")}
      aria-hidden
    >
      {fill > 0 && (
        <>
          <clipPath id={clip}>
            <path d={BODY} />
          </clipPath>
          <rect
            x="7"
            y={bottom - fill}
            width="10"
            height={fill}
            clipPath={`url(#${clip})`}
            className="fill-current opacity-70"
            stroke="none"
          />
        </>
      )}
      <path d="M10 2.5h4M10.5 2.5v3.4l-2.6 2.6A2 2 0 0 0 7.3 9.9V20a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5V9.9a2 2 0 0 0-.6-1.4l-2.6-2.6V2.5" />
    </svg>
  );
}
