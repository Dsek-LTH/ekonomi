import { notFound } from "next/navigation";

import { getKnownGroups } from "@/lib/data/authority";
import { getResultUnits } from "@/lib/data/result-units";
import { canAccessSettings } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";
import { titled } from "@/lib/server/page-title";
import { UnitClient } from "./unit-client";

export const generateMetadata = titled("resultUnits");

export default async function AdminResultUnitPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage(canAccessSettings);
  const { id } = await params;
  const [units, knownGroups] = await Promise.all([getResultUnits(), getKnownGroups()]);
  const unit = units.find((u) => u.id === id);
  if (!unit) notFound();

  return <UnitClient key={unit.id} unit={unit} knownGroups={knownGroups} />;
}
