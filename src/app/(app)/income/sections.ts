// The two halves of working with income, as the shell's `collections` prop.
//
// What is waiting to be booked, and what has been. They are different jobs, done
// at different times and often by different people, and they are different
// *kinds* of thing: the first is a working set the next fetch replaces, the
// second is the section's record. So they are two pages, and switching between
// them is a link rather than a state.
//
// How a fetch's reports are looked at (one day at a time or as a table) is not
// a third section: it is the same reports, drawn differently, which is the view
// toggle's question and not this one.
//
// Here rather than in either client because both pages render this switch, and
// the labels, the counts and the two hrefs have to agree between them. It used
// to be a component of its own (income-nav.tsx) that did its own layout as well;
// now the layout is PageShell's, everywhere, and this is only the content.
import type { Collections } from "@/components/ui/collection-switch";

type IncomeSection = "review" | "booked";

const HREF: Record<IncomeSection, string> = {
  review: "/income",
  booked: "/income/booked",
};

export function incomeSections({
  active,
  label,
  labels,
  counts,
}: {
  active: IncomeSection;
  /** Names the switch for a screen reader. */
  label: string;
  labels: Record<IncomeSection, string>;
  /** Shown after a label when there is something waiting there. */
  counts?: Partial<Record<IncomeSection, number>>;
}): Collections {
  return {
    label,
    value: active,
    options: (Object.keys(HREF) as IncomeSection[]).map((section) => ({
      value: section,
      label: labels[section],
      count: counts?.[section],
    })),
    href: (value) => HREF[value as IncomeSection],
  };
}
