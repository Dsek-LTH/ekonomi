"use client";

// The two pieces of furniture every wizard step wears: the shape of a pickable
// option, and the strip of buttons at the foot.
//
// Their own file so a step can live in one too. They were defined inside
// new-client.tsx, which meant the only place a step could be written was inside
// new-client.tsx.
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";

// Three of the wizard's questions are answered by picking one of a few: which
// way the money goes, how it was paid, and which bank transaction to match.
// Both are a bordered card that fills with accent once chosen.
export const optionCard = (selected: boolean) =>
  cn(
    "w-full rounded-xl border px-4 py-3 text-left transition-colors",
    selected ? "border-accent bg-accent-soft" : "border-border hover:bg-hover",
  );

// Every wizard step ends the same way: back on the left, "save draft" and the
// step's own primary action on the right.
export function StepFooter({
  onBack,
  onSave,
  saveLabel,
  saveDisabled,
  saving,
  children,
}: {
  /** Omitted on the first step, which has nowhere to go back to. */
  onBack?: () => void;
  onSave: () => void;
  saveLabel: string;
  saveDisabled: boolean;
  /** The draft save this footer owns is in flight, not the step's own action. */
  saving: boolean;
  children?: React.ReactNode;
}) {
  const t = useTranslations("expenses.wizard");
  return (
    <div className="flex flex-wrap justify-between gap-2.5 pt-1">
      {onBack ? (
        <Button variant="secondary" onClick={onBack}>
          {t("back")}
        </Button>
      ) : (
        // Keeps the save/primary pair against the right edge, where they are on
        // every other step.
        <span />
      )}
      <div className="flex gap-2.5">
        <Button variant="secondary" onClick={onSave} loading={saving} disabled={saveDisabled}>
          {saveLabel}
        </Button>
        {children}
      </div>
    </div>
  );
}
