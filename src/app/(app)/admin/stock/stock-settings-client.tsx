"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { useMutation } from "@/components/shell/use-mutation";
import type { UpdateStockSettings } from "@/lib/api/schemas/stock";

export function StockSettingsClient({ settings }: { settings: { expiryLeadDays: number | null } }) {
  const t = useTranslations("admin.stock");
  const { pending, mutate } = useMutation();
  const [days, setDays] = useState(
    settings.expiryLeadDays === null ? "" : String(settings.expiryLeadDays),
  );

  const parsed = Number(days.trim());
  const valid = days.trim() !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= 365;
  const changed = valid && parsed !== settings.expiryLeadDays;

  async function save() {
    const body: UpdateStockSettings = { expiryLeadDays: parsed };
    await mutate("/api/stock/settings", { method: "PATCH", body, error: t("saveFailed") });
  }

  return (
    <Card>
      <CardHeader title={t("expiry.title")} subtitle={t("expiry.hint")} />
      <CardBody className="space-y-4">
        <div className="max-w-xs">
          <Field label={t("expiry.leadDays")} hint={t("expiry.leadDaysHint")}>
            <Input
              value={days}
              onChange={(e) => setDays(e.target.value)}
              inputMode="numeric"
              className="tabular-nums"
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={!changed} loading={pending !== null}>
            {t("save")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
