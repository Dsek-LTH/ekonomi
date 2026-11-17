// Own module: a server page importing from the "use client" shell would pull the shell across the boundary.
// The sections and their order are docs/settings.md's.
import {
  IconBox,
  IconCar,
  IconCard,
  IconChart,
  IconHierarchy,
  IconIncome,
  IconMail,
  IconShield,
  IconUsers,
} from "@/components/ui/icons";
import { IconFortnox } from "./fortnox-mark";

export const SETTINGS_ROOT = "/admin";

export interface SettingsSection {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.ReactElement;
}

export interface SettingsSectionGroup {
  /** Under `admin.index.group`. */
  label: string;
  sections: SettingsSection[];
}

export const SETTINGS_GROUPS: SettingsSectionGroup[] = [
  {
    label: "bookkeeping",
    sections: [
      { href: "/admin/fortnox", label: "fortnox", icon: IconFortnox },
      { href: "/admin/cost-centers", label: "costCenters", icon: IconChart },
      {
        href: "/admin/result-units",
        label: "resultUnits",
        icon: IconHierarchy,
      },
    ],
  },
  {
    label: "expenses",
    sections: [
      { href: "/admin/expenses", label: "expenseSettings", icon: IconCar },
      { href: "/admin/cards", label: "cards", icon: IconCard },
    ],
  },
  {
    label: "operations",
    sections: [
      { href: "/admin/income", label: "salesSettings", icon: IconIncome },
      { href: "/admin/stock", label: "stockSettings", icon: IconBox },
    ],
  },
  {
    label: "access",
    sections: [
      { href: "/admin/users", label: "users", icon: IconUsers },
      { href: "/admin/roles", label: "roles", icon: IconShield },
    ],
  },
  {
    label: "system",
    sections: [{ href: "/admin/email", label: "email", icon: IconMail }],
  },
];

export const SETTINGS_SECTIONS: SettingsSection[] = SETTINGS_GROUPS.flatMap((g) => g.sections);

/** The section a settings path is in: its own page, or a record under it (`/admin/users/[id]`). */
export const sectionOf = (path: string): SettingsSection | null =>
  SETTINGS_SECTIONS.find((s) => path === s.href || path.startsWith(`${s.href}/`)) ?? null;
