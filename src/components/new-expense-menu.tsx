"use client";

// "Nytt utlägg", which is two verbs (purchase or milersättning, different forms) answered before either
// form is drawn. One menu (components/ui/menu.tsx) shared by the call sites.
import { useProgressRouter } from "@/components/shell/route-progress";
import { useTranslations } from "next-intl";
import { Menu, MenuItem } from "@/components/ui/menu";
import { IconPlus } from "@/components/ui/icons";

/** One line of the menu: what it is, and who it is for (the second line matters to newcomers). */
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
  /** The trigger's own words, where the screen has better ones than "Nytt utlägg". */
  label?: string;
  /** Matches the button this replaces: outlined in a toolbar, filled in an empty state. */
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
