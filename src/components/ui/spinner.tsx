import { cn } from "@/lib/ui/utils";

// For waits whose shape is unknown; use a Skeleton where it is known. `currentColor`, so it takes the label colour.
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
      // Exempt from the reduced-motion block in globals.css: it keeps turning, just slower.
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
