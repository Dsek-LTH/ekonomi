"use client";

// The pieces the utlägg form is built from: a choice card and a titled
// section. Its action bar along the foot is components/action-bar.tsx.
//
// It was a wizard of two or three steps, the last of which only repeated what
// had just been typed. One page now, with saving and sending always in reach
// and the bar saying what is still missing rather than leaving a grey button
// to be puzzled over.
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/ui/utils";

export const optionCard = (selected: boolean, locked = false) =>
  cn(
    "w-full rounded-control border px-4 py-3 text-left transition-colors",
    selected
      ? "border-accent bg-accent-soft"
      : locked
        ? "border-border opacity-50"
        : "border-border hover:bg-hover",
  );

/** One part of the form, as a card. A heading only where the part needs one
 *  to say what it is asking (which card purchase it was). */
export function FormSection({
  title,
  hint,
  children,
}: {
  title?: string;
  /** Beside the heading: a "?" with the explanation the section has no room for. */
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <section className="space-y-4 px-inset py-5">
        {title && (
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            {title}
            {hint}
          </h2>
        )}
        {children}
      </section>
    </Card>
  );
}
