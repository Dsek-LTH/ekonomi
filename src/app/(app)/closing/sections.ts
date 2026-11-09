// The three parts of one year's bokslut as the shell's `pages` prop (checklist, vouchers,
// balance accounts): page tabs, not the scope switch (docs/navigation.md). Shared so labels
// and hrefs agree.
import type { PageTabsProps } from "@/components/ui/page-tabs";

export type ClosingSection = "checklist" | "vouchers" | "accounts";

const SECTIONS: ClosingSection[] = ["checklist", "vouchers", "accounts"];

export function closingSections({
  active,
  label,
  labels,
}: {
  active: ClosingSection;
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
