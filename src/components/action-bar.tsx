"use client";

// The bar pinned to the foot of a long form or sheet: totals, what is missing, and the way out.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";

/** Pinned to the foot of the form: what this utlägg comes to, what is missing before it can be sent, and the two ways out. */
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
  // Pinned only from md. On a phone it scrolls with the form (pinned, it covered the field being typed in).
  const wide = useWide();
  const stuck = pinned && wide;
  return (
    // While `stuck` only: the form fades out above the bar, the bar blurs what is behind it, and the negative
    // bottom margin hands back the main column's bottom padding (shell/app-shell.tsx).
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
            // A column on a phone, the buttons sharing a row under the text.
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

/** Whether the bar is pinned over the form, as against resting at the end of a page that fits. Told by a pixel placed where the bar would sit unstuck. */
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
