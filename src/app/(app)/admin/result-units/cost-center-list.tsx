"use client";

import { useTranslations } from "next-intl";

import type { ResultUnitCostCenter } from "@/lib/domain/types";
import { cn } from "@/lib/ui/utils";

/** Cost centres as rows of code and name, active ones first. */
export function CostCenterList({ list }: { list: ResultUnitCostCenter[] }) {
  const t = useTranslations("admin.resultUnits");
  if (list.length === 0) {
    return <p className="px-inset py-3 text-sm text-muted">{t("unassignedEmpty")}</p>;
  }
  const sorted = [...list].sort((a, b) => Number(b.active) - Number(a.active));
  return (
    <ul>
      {sorted.map((cc) => (
        <li
          key={cc.code}
          className={cn(
            "flex items-center gap-4 border-b border-border px-inset py-2 last:border-0",
            !cc.active && "opacity-55",
          )}
        >
          <span className="w-20 shrink-0 font-mono text-xs font-semibold">{cc.code}</span>
          <span className="min-w-0 flex-1 truncate text-sm">{cc.name}</span>
          {!cc.active && <span className="text-xs text-muted">{t("inactive")}</span>}
        </li>
      ))}
    </ul>
  );
}
