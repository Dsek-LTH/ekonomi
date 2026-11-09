// Own module: a server page importing from the "use client" shell would pull the shell across the boundary.
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

interface SettingsSection {
  href: string;
  label: string;
  blurb: string;
  icon: (p: { className?: string }) => React.ReactElement;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { href: "/admin/fortnox", label: "fortnox", blurb: "fortnox", icon: IconFortnox },
  { href: "/admin/cost-centers", label: "costCenters", blurb: "costCenters", icon: IconChart },
  { href: "/admin/income", label: "salesSettings", blurb: "income", icon: IconIncome },
  {
    href: "/admin/result-units",
    label: "resultUnits",
    blurb: "resultUnits",
    icon: IconHierarchy,
  },
  { href: "/admin/cards", label: "cards", blurb: "cards", icon: IconCard },
  { href: "/admin/mileage", label: "mileageRates", blurb: "mileageRates", icon: IconCar },
  { href: "/admin/stock", label: "stockSettings", blurb: "stockSettings", icon: IconBox },
  { href: "/admin/roles", label: "roles", blurb: "roles", icon: IconShield },
  { href: "/admin/users", label: "users", blurb: "users", icon: IconUsers },
  { href: "/admin/email", label: "email", blurb: "email", icon: IconMail },
];
