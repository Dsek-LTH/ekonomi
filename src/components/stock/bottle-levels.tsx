"use client";

// What is on the shelf of a product, drawn rather than spelled out.
//
// "3 oöppnade, 1 på 60 %" is a sentence to read on every row of a list. As
// bottles it is read at a glance: a full one with its count beside it for the
// sealed, and each opened bottle filled to its level, so the shelf that is
// about to run dry looks like it. A can or a bottle of beer is never opened
// on the shelf, so a UNIT product is its count and nothing to draw.
//
// The words are still there, as the drawing's accessible name and its title.
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
  /** `lg` on the product page, where it is the figure the page is about. */
  size?: "sm" | "lg";
}) {
  const t = useTranslations("stock");
  const big = size === "lg";

  if (kind === "UNIT") {
    return (
      <span className={cn("tabular-nums", big ? "text-2xl font-semibold" : "", sealed === 0 && "text-muted")}>
        {t("holding.unit", { units: sealed })}
      </span>
    );
  }

  // Fullest first, the order they will be poured in reverse.
  const levels = LEVELS.flatMap((l) => Array.from({ length: bottlesAt(open, l) }, () => l));
  const shown = levels.slice(0, MAX_OPEN);
  const more = levels.length - shown.length;
  const label = t("holding.volume", { sealed, open: levels.length });

  return (
    <span role="img" aria-label={label} title={label} className="inline-flex items-center gap-1.5">
      <span className={cn("inline-flex items-center gap-0.5", sealed === 0 && "opacity-40")}>
        <Bottle level={100} big={big} />
        <span className={cn("tabular-nums", big ? "text-2xl font-semibold leading-none" : "text-sm")}>
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

/**
 * One bottle, filled to `level` per cent.
 *
 * Drawn the way every icon in the app is (components/ui/icons.tsx): a 24-unit
 * box, a 1.6 stroke with round ends and joins, in the muted ink. The liquid is
 * the same ink rather than a colour of its own: it was amber in a narrow
 * 10-unit bottle of a thinner line, and next to the list's other marks it
 * looked like it came from somewhere else.
 *
 * The liquid fills the body wall to wall, clipped to the bottle's own outline
 * and drawn under its stroke, at most of the ink's strength. It was a faint
 * rectangle standing clear of the glass, and at 18 pixels the difference
 * between 40 and 60 % was a guess.
 *
 * Exported for the event sheet, which marks each rung of a spirit's ladder with
 * the bottle it stands for.
 */
const BODY =
  "M10.5 5.9l-2.6 2.6A2 2 0 0 0 7.3 9.9V20a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5V9.9a2 2 0 0 0-.6-1.4l-2.6-2.6z";

export function Bottle({ level, big = false }: { level: number; big?: boolean }) {
  // The inside of the body runs from the foot of the neck at y 5.9 down to
  // 20.7, where the base's stroke begins. The level is measured over that,
  // shoulder included: measured from where the shoulder starts to slope, a full
  // bottle left the shoulder empty and read as four-fifths full. The liquid
  // carries on under the stroke to the outline at 21.5, so 20 % shows as 20 %
  // of the glass rather than mostly hidden behind the base. The neck is never
  // filled, since an opened bottle's level is a fraction of what the body
  // holds.
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
