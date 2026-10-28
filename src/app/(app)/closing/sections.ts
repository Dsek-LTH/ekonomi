// The three parts of one year's bokslut, as the shell's `pages` prop: the
// checklist that says what is left, the vouchers to review, and the balance
// accounts to mark as reconciled. Parts of one record, so page tabs under the
// year's title rather than the scope switch (see docs/navigation.md). Here
// rather than in any one client because all three render them, and their
// labels and hrefs have to agree.
import type { PageTabsProps } from "@/components/ui/page-tabs";

export type ClosingSection = "checklist" | "vouchers" | "accounts";

const SECTIONS: ClosingSection[] = ["checklist", "vouchers", "accounts"];

export function closingSections({
  active,
  label,
  labels,
}: {
  active: ClosingSection;
  /** Names the row for a screen reader. */
  label: string;
  labels: Record<ClosingSection, string>;
}): PageTabsProps {
  return {
    label,
    value: active,
    options: SECTIONS.map((s) => ({
      value: s,
      label: labels[s],
      href: s === "checklist" ? "/closing" : `/closing/${s}`,
    })),
  };
}
