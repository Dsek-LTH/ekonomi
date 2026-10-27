"use client";

// Settings → Lager. How much notice to give before a delivery's best-before.
//
// One number, and it is section policy rather than a fact about any product.
// How long a lager keeps is nine months and how long a cider keeps is
// twenty-one, and both belong on the product. How much warning you want is
// about how long it takes to drink a crate once somebody knows it needs
// drinking, which is the same figure whatever is in the crate. Folding it into
// the product would have been the cheaper schema and the wrong one: changing
// your mind about notice would then mean editing every product on the shelf.
//
// What it does not control is which products are watched at all. A product with
// no shelf life raises no checks however this is set, which is the gap showing
// as a gap. See lib/stock/expiry.ts.
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
  // Empty until chosen. Nothing is filled in for the reader: the notice period
  // is the section's decision, and no checks are raised until it is made.
  const [days, setDays] = useState(
    settings.expiryLeadDays === null ? "" : String(settings.expiryLeadDays),
  );

  const parsed = Number(days.trim());
  // Not empty: Number("") is 0, and an empty box saved as 0 would be a choice
  // nobody made.
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
