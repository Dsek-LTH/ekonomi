import { cn } from "@/lib/ui/utils";

// The app's one indeterminate mark, for waits whose shape isn't known: a button
// mid-request, a small inline fetch, a PDF being rendered. Where the shape *is*
// known (a table, a card, a page) use a Skeleton instead, so the wait looks
// like the thing that's coming.
//
// Drawn in `currentColor`, so it takes the label colour of whatever it sits in
// and needs no variant of its own: on the brand fill it is near-black, on a
// danger button white, on a page it is muted.
const SIZES = {
  sm: "size-3.5 border-[1.5px]", // inside a small control
  md: "size-[18px] border-2", //    inside a normal button, or a field
  lg: "size-7 border-[2.5px]", //   standing alone in a region
};

export function Spinner({
  size = "md",
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      // The reduced-motion block in globals.css stops everything that moves;
      // this attribute is what exempts it. A spinner that doesn't spin isn't a
      // spinner, it's a ring, so it keeps turning, just slower.
      data-spinner=""
      aria-hidden
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-current/25 border-t-current",
        SIZES[size],
        className,
      )}
    />
  );
}
