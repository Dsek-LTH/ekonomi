// The sections under Inställningar, in the order they are listed.
//
// Its own module because two things read it and they cannot be in the same
// file: the sidebar (app-shell, a client component) and the settings landing
// page (a server component). A server page importing from a "use client" module
// pulls the whole shell across the boundary with it, so the list lives here,
// free of both.
//
// Order is the reading order and it is deliberate: the connection that
// everything else depends on first, then the tables it syncs, then the section's
// own records, then who may do what. `roles` sits directly above `users`,
// because that one lists who holds what and cannot change it, and this is where
// what a holding *means* is decided.
import {
  IconBox,
  IconCar,
  IconCard,
  IconChart,
  IconHierarchy,
  IconIncome,
  IconShield,
  IconUsers,
} from "@/components/ui/icons";
import { IconFortnox } from "./fortnox-mark";

export interface SettingsSection {
  href: string;
  /** Key under `nav`, the same one the sidebar names it by. */
  label: string;
  /** Key under `admin.sections`, one line on the landing page saying what it
   *  is for. The sidebar has no room for it and does not show it. */
  blurb: string;
  icon: (p: { className?: string }) => React.ReactElement;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { href: "/admin/fortnox", label: "fortnox", blurb: "fortnox", icon: IconFortnox },
  { href: "/admin/cost-centers", label: "costCenters", blurb: "costCenters", icon: IconChart },
  { href: "/admin/income", label: "income", blurb: "income", icon: IconIncome },
  { href: "/admin/result-units", label: "resultUnits", blurb: "resultUnits", icon: IconHierarchy },
  { href: "/admin/cards", label: "cards", blurb: "cards", icon: IconCard },
  { href: "/admin/mileage", label: "mileageRates", blurb: "mileageRates", icon: IconCar },
  { href: "/admin/stock", label: "stockSettings", blurb: "stockSettings", icon: IconBox },
  // Not configuration of the app, which is what everything else on this list
  // is, but a list of the section's own things. It is here because there is
  // nowhere better: the archive itself is a screen for reading contracts, and
  // the catalogue is maintained rather than read. See the page's own note.
  { href: "/admin/roles", label: "roles", blurb: "roles", icon: IconShield },
  { href: "/admin/users", label: "users", blurb: "users", icon: IconUsers },
];
