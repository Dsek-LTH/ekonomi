"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { useQuery } from "@/components/shell/use-query";
import { Combobox } from "@/components/ui/combobox";
import type { FortnoxCustomer } from "@/lib/fortnox";
import { useReloadOnRegisterChange } from "@/lib/ui/fortnox-registers";

/** Fortnox's customer register, read when the dialog opens and again on coming back from Fortnox. Customers are added in Fortnox, never here. */
export function useFortnoxCustomers() {
  const q = useQuery<FortnoxCustomer[]>("/api/fortnox/customers");
  useReloadOnRegisterChange(q.reload);
  const list = useMemo(() => q.data ?? [], [q.data]);
  return { list, loading: q.loading, error: q.error, reload: q.reload };
}

/**
 * The customer a member's invoice goes to when nobody has picked one: the one used last time, else the only
 * customer with their email, else the only one with their exact name. Empty when that is not certain.
 */
export function guessCustomer(
  list: readonly FortnoxCustomer[],
  member: { customerNumber: string | null; email?: string; name: string },
): string {
  if (member.customerNumber && list.some((c) => c.number === member.customerNumber))
    return member.customerNumber;
  const only = (match: (c: FortnoxCustomer) => boolean) => {
    const hits = list.filter(match);
    return hits.length === 1 ? hits[0].number : "";
  };
  const email = member.email?.trim().toLowerCase();
  const name = member.name.trim().toLowerCase();
  return (
    (email ? only((c) => c.email?.trim().toLowerCase() === email) : "") ||
    only((c) => c.name.trim().toLowerCase() === name)
  );
}

/** Picking a member's customer from the register, and what to do when they are not in it. */
export function CustomerPicker({
  customers,
  value,
  onChange,
  memberName,
}: {
  customers: ReturnType<typeof useFortnoxCustomers>;
  value: string;
  onChange: (number: string) => void;
  memberName: string;
}) {
  const t = useTranslations("board.customer");
  const options = customers.list.map((c) => ({
    value: c.number,
    label: `${c.number} - ${c.name}${c.email ? ` (${c.email})` : ""}`,
    short: `${c.number} - ${c.name}`,
  }));
  return (
    <div>
      <Combobox
        size="sm"
        options={options}
        value={value}
        onChange={onChange}
        placeholder={customers.loading ? t("loading") : t("pick")}
        searchPlaceholder={t("search")}
        aria-label={t("label", { name: memberName })}
        searchable
      />
      {!value && !customers.loading && (
        <p className="mt-1 text-xs text-muted">
          {t("missing")}{" "}
          <button type="button" className="text-link hover:underline" onClick={customers.reload}>
            {t("reload")}
          </button>
        </p>
      )}
    </div>
  );
}
