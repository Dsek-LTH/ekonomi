"use client";

// "Nytt utlägg", which is really two verbs.
//
// A purchase and a milersättning are described by different forms — one has a
// receipt, an amount and possibly a card purchase to match; the other has a
// date and two odometer readings — so which one you need is a question that has
// to be answered before either form can be drawn.
//
// It used to be answered *inside* the purchase form, as a third card in its
// payment-type group. That put a door among the switches: its two neighbours
// set a field and it navigated away, abandoning everything typed above it. It
// also sat at the bottom of the step, so it was found after the work it
// discarded, and it made a three-item grid out of a two-column one.
//
// Here instead, where nothing has been typed yet and nothing can be lost. This
// is the case components/ui/menu.tsx was written for — one button that is two
// or three variants of the same verb — and putting it in one component rather
// than at each of the five call sites is what keeps them saying the same thing.
import { useProgressRouter } from "@/components/shell/route-progress";
import { useTranslations } from "next-intl";
import { Menu, MenuItem } from "@/components/ui/menu";
import { IconPlus } from "@/components/ui/icons";

/** One line of the menu: what it is, and who it is for. The second line is not
 *  decoration — "vanligt utlägg" and "milersättning" are section vocabulary,
 *  and somebody filing their first one is choosing on the description. */
function Choice({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted">{hint}</span>
    </span>
  );
}

export function NewExpenseMenu({
  label,
  variant,
  size,
  className,
}: {
  /**
   * The trigger's own words, where the screen has better ones than "Nytt
   * utlägg" — the dashboard's first-run card says "Skapa ditt första utlägg",
   * and a newcomer being walked through the four steps should not be met with
   * the toolbar's wording at the end of them. The menu inside is the same
   * either way.
   */
  label?: string;
  /** Matches the button this replaces at each call site — the list's toolbar
   *  wants the outlined register, an empty state wants the filled one. */
  variant?: React.ComponentProps<typeof Menu>["variant"];
  size?: React.ComponentProps<typeof Menu>["size"];
  className?: string;
}) {
  const router = useProgressRouter();
  const t = useTranslations("expenses.newMenu");

  return (
    <Menu
      label={label ?? t("label")}
      icon={<IconPlus className="size-4" />}
      variant={variant}
      size={size}
      className={className}
    >
      <MenuItem onClick={() => router.push("/expenses/new")}>
        <Choice label={t("ordinary")} hint={t("ordinaryHint")} />
      </MenuItem>
      <MenuItem onClick={() => router.push("/expenses/new/mileage")}>
        <Choice label={t("mileage")} hint={t("mileageHint")} />
      </MenuItem>
    </Menu>
  );
}
