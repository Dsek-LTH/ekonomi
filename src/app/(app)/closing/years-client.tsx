"use client";

import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { useTableControls } from "@/lib/data/use-list-query";
import type { ClosingYear } from "@/lib/data/closing";
import { useFormat } from "@/lib/ui/use-format";

export default function ClosingYearsClient({ years }: { years: ClosingYear[] }) {
  const t = useTranslations("closing");
  const { date, dateTime } = useFormat();
  const controls = useTableControls();

  const columns: Column<ClosingYear>[] = [
    {
      key: "year",
      header: t("years.col.year"),
      mobile: "title",
      cell: (y) => <span className="font-medium">{y.year}</span>,
    },
    {
      key: "period",
      header: t("years.col.period"),
      mobile: "meta",
      cell: (y) => `${date(y.fromDate)} - ${date(y.toDate)}`,
    },
    {
      key: "vouchers",
      header: t("years.col.vouchers"),
      align: "right",
      mobile: "trailing",
      cell: (y) => y.vouchers,
    },
    {
      key: "synced",
      header: t("years.col.synced"),
      mobile: "meta",
      cell: (y) => (y.lastSyncAt ? dateTime(y.lastSyncAt) : t("never")),
    },
  ];

  return (
    <PageShell title={t("title")}>
      <Card>
        <ClientDataTable
          columns={columns}
          rows={years}
          controls={controls}
          rowKey={(y) => String(y.id)}
          rowHref={(y) => `/closing/${y.id}`}
          empty={t("years.empty")}
          action={
            <ButtonLink href="/closing/template" size="sm" variant="secondary">
              {t("template.title")}
            </ButtonLink>
          }
        />
      </Card>
    </PageShell>
  );
}
