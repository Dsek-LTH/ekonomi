"use client";

// How utlägg reach Fortnox: the series they are exported into, and the two accounts the payment row is posted
// against. All three are required and wait for the page's Spara (docs/settings.md).
import { useTranslations } from "next-intl";

import { SettingRow, SettingsCard, SettingsRows } from "@/components/settings/settings-card";
import { useDraft, useDraftPart } from "@/components/settings/settings-draft";
import { useMutation } from "@/components/shell/use-mutation";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/field";
import type { AccountRecord, BookkeepingSettings } from "@/lib/domain/types";

export function BookingCard({
  settings,
  accounts,
}: {
  settings: BookkeepingSettings;
  accounts: AccountRecord[];
}) {
  const t = useTranslations("admin.expenses");
  const tBook = useTranslations("book");
  const { mutate } = useMutation();

  const accountOptions: ComboOption[] = accounts
    .filter((a) => a.active)
    .map((a) => ({ value: a.number, label: `${a.number} - ${a.name}` }));

  const draft = useDraft({
    expenseVoucherSeries: settings.expenseVoucherSeries ?? "",
    bankAccount: settings.bankAccount ?? "",
    memberDebtAccount: settings.memberDebtAccount ?? "",
  });
  const d = draft.value;
  const needed = (value: string) => (value.trim() ? null : t("needed"));

  useDraftPart({
    dirty: draft.dirty,
    save: async () =>
      (await mutate("/api/expense-settings", {
        method: "PATCH",
        body: draft.changes,
        error: t("saveFailed"),
        refresh: false,
      })) !== null,
    commit: draft.commit,
    reset: draft.reset,
  });

  return (
    <SettingsCard title={t("booking")}>
      <SettingsRows>
        <SettingRow
          label={t("voucherSeries")}
          hint={t("voucherSeriesHint")}
          required
          missing={needed(d.expenseVoucherSeries)}
        >
          <Input
            size="sm"
            value={d.expenseVoucherSeries}
            onChange={(e) =>
              draft.set("expenseVoucherSeries", e.target.value.toUpperCase().slice(0, 4))
            }
            aria-label={t("voucherSeries")}
            className="min-w-0 font-mono uppercase"
          />
        </SettingRow>
        <SettingRow
          label={t("bankAccount")}
          hint={t("bankAccountHint")}
          required
          missing={needed(d.bankAccount)}
        >
          <Combobox
            size="sm"
            options={accountOptions}
            value={d.bankAccount}
            onChange={(v) => v && draft.set("bankAccount", v)}
            placeholder={tBook("accountPlaceholder")}
            searchPlaceholder={tBook("accountSearch")}
            aria-label={t("bankAccount")}
          />
        </SettingRow>
        <SettingRow
          label={t("debtAccount")}
          hint={t("debtAccountHint")}
          required
          missing={needed(d.memberDebtAccount)}
        >
          <Combobox
            size="sm"
            options={accountOptions}
            value={d.memberDebtAccount}
            onChange={(v) => v && draft.set("memberDebtAccount", v)}
            placeholder={tBook("accountPlaceholder")}
            searchPlaceholder={tBook("accountSearch")}
            aria-label={t("debtAccount")}
          />
        </SettingRow>
      </SettingsRows>
    </SettingsCard>
  );
}
