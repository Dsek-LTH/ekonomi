"use client";

// The bar pinned to the foot of a long form or sheet: what it comes to, what
// is still missing, and the way out. The utlägg form's, first, and the
// stocktake sheet's.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";

/**
 * Pinned to the foot of the form: what this utlägg comes to, what is still
 * missing before it can be sent, and the two ways out.
 *
 * The missing list is the answer to the question a disabled button raises. It
 * names fields rather than pointing at them, because on a phone they are a
 * scroll away and a list is something to work down.
 */
export function ActionBar({
  summary,
  missing,
  missingLabel,
  note,
  onSave,
  saveLabel,
  saveDisabled,
  saving,
  submit,
}: {
  summary: React.ReactNode;
  /** Short names of what is still to fill in. Empty once nothing is. */
  missing: string[];
  /** "Saknas", what the list is led by. */
  missingLabel: string;
  /** Anything else stopping it, said in full (too old, no payout account). */
  note?: React.ReactNode;
  onSave: () => void;
  saveLabel: string;
  saveDisabled: boolean;
  saving: boolean;
  /** Left out where the utlägg can no longer be sent from here. */
  submit?: { label: string; onClick: () => void; disabled: boolean; loading: boolean };
}) {
  const { stuck: pinned, sentinel } = useStuck();
  // Pinned only from md. On a phone the bar is the last thing in the form and
  // scrolls with it. Pinned, it wrapped to three lines over a screen the
  // keyboard had already halved, sat on the field being typed in, and made
  // every scroll of the form a scroll past something that did not move.
  const wide = useWide();
  const stuck = pinned && wide;
  return (
    // Set off from what scrolls under it three ways, as a floating bar has to
    // be: the form fades out above it into the page's own colour, the bar
    // blurs whatever is still behind it, and it casts its shadow upwards,
    // onto the content, rather than down onto the edge of the screen.
    //
    // The fade is drawn above the bar rather than given room: it overlaps the
    // form instead of pushing the bar 32px further from it. And the negative
    // bottom margin hands back most of the main column's bottom padding
    // (shell/app-shell.tsx), which is there so a page's last card clears the
    // end of the scroll. This bar is that last thing, and it already clears
    // it, so the padding was only a second gap under it.
    //
    // All of that only while something is actually under it (`stuck`). On a
    // form short enough to end above the fold the bar is simply the last thing
    // on the page, and a fade there only dimmed the card above it.
    <>
    <div
      className={cn(
        "pointer-events-none z-20 -mx-2 mt-4 px-2 md:sticky md:bottom-0 md:-mb-17 md:pb-3",
        stuck && "bg-gradient-to-t from-canvas from-60% to-transparent",
      )}
    >
      {stuck && (
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-full h-8 bg-gradient-to-t from-canvas to-transparent"
        />
      )}
      <div
        className={cn(
          // A column on a phone: what it comes to and what is missing across
          // the whole width, then the two buttons sharing a row under it.
          // Side by side, the text was the one thing allowed to shrink, and
          // two buttons left it a sliver to wrap "Saknas: …" into.
          "pointer-events-auto flex flex-col gap-3 rounded-panel border border-border px-inset py-3 transition-shadow md:flex-row md:flex-wrap md:items-center md:gap-x-4",
          stuck
            ? "bg-background/80 shadow-[0_-8px_32px_-8px_rgb(0_0_0/0.18),0_2px_8px_-2px_rgb(0_0_0/0.08)] backdrop-blur-xl backdrop-saturate-150"
            : "bg-background shadow-[var(--shadow-card)]",
        )}
      >
        <div className="min-w-0 text-sm md:flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">{summary}</div>
          {missing.length > 0 ? (
            <p className="mt-0.5 text-xs text-warning">{`${missingLabel}: ${missing.join(", ")}`}</p>
          ) : (
            note && <div className="mt-0.5">{note}</div>
          )}
        </div>
        <div className="flex gap-2.5 md:shrink-0">
          <Button
            variant="secondary"
            onClick={onSave}
            loading={saving}
            disabled={saveDisabled}
            className="flex-1 md:flex-none"
          >
            {saveLabel}
          </Button>
          {submit && (
            <Button
              onClick={submit.onClick}
              loading={submit.loading}
              disabled={submit.disabled}
              className="flex-1 md:flex-none"
            >
              {submit.label}
            </Button>
          )}
        </div>
      </div>
    </div>
    <div ref={sentinel} aria-hidden className="h-px" />
    </>
  );
}

/** From md, where the bar is pinned. Only ever true in the browser. */
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return wide;
}

/**
 * Whether the bar is pinned to the foot of the screen with the form going on
 * under it, as against resting at the end of a page that fits.
 *
 * Told by a pixel placed where the bar would sit if it were not sticky: while
 * that is on screen the bar is where it belongs anyway, and once it has gone
 * off the bottom the bar is holding on over content. Observed against the
 * viewport, which also accounts for whatever scroll container clips it.
 */
function useStuck() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!node) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting));
    io.observe(node);
    return () => io.disconnect();
  }, [node]);
  return { stuck, sentinel: setNode };
}
