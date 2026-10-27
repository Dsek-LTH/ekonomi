// The three parts of one year's bokslut, as the shell's `collections` prop: the
// checklist that says what is left, the vouchers to review, and the balance
// accounts to mark as reconciled. Here rather than in any one client because
// all three render the switch, and its labels and hrefs have to agree.
import type { Collections } from "@/components/ui/collection-switch";

export type ClosingSection = "checklist" | "vouchers" | "accounts";

const SECTIONS: ClosingSection[] = ["checklist", "vouchers", "accounts"];

export function closingSections({
  yearId,
  active,
  label,
  labels,
}: {
  yearId: number;
  active: ClosingSection;
  /** Names the switch for a screen reader. */
  label: string;
  labels: Record<ClosingSection, string>;
}): Collections {
  return {
    label,
    value: active,
    options: SECTIONS.map((s) => ({ value: s, label: labels[s] })),
    href: (value) =>
      value === "checklist" ? `/closing/${yearId}` : `/closing/${yearId}/${value}`,
  };
}
