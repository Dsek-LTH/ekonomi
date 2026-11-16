"use client";

// The board's price list. A price is set from a day on, so changing one mid-year never touches what somebody
// has already taken: a withdrawal carries the price of its own day.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { PageShell } from "@/components/page-shell";
import { useMutation } from "@/components/shell/use-mutation";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { DateInput, Field } from "@/components/ui/field";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Tag } from "@/components/ui/status-pill";
import type { SetBoardPrice } from "@/lib/api/schemas/board";
import type { BoardPriceDto } from "@/lib/data/board";
import { sekToOre } from "@/lib/domain/money";
import { useTableControls } from "@/lib/data/use-list-query";
import { useFormat } from "@/lib/ui/use-format";

import { kr, kronor } from "../tab-view";

export default function BoardPricesClient({
  prices,
  today,
  canManage,
}: {
  prices: BoardPriceDto[];
  today: string;
  canManage: boolean;
}) {
  const t = useTranslations("board.prices");
  const { date } = useFormat();
  const controls = useTableControls({ sortKey: "product", sortDir: "asc" });
  const [editing, setEditing] = useState<BoardPriceDto | null>(null);

  const columns: Column<BoardPriceDto>[] = [
    {
      key: "product",
      header: t("col.product"),
      value: (p) => p.name,
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (p) => <span className="font-medium">{p.name}</span>,
    },
    {
      key: "cost",
      header: t("col.cost"),
      align: "right",
      value: (p) => p.costPriceOre ?? -1,
      sortable: true,
      mobile: "hide",
      cell: (p) =>
        p.costPriceOre == null ? (
          <span className="text-muted">-</span>
        ) : (
          <Amount value={kronor(p.costPriceOre)} className="font-normal text-muted" />
        ),
    },
    {
      key: "price",
      header: t("col.price"),
      align: "right",
      value: (p) => p.priceOre ?? -1,
      sortable: true,
      mobile: "trailing",
      cell: (p) =>
        p.priceOre == null ? (
          <span className="text-muted">{t("none")}</span>
        ) : (
          <Amount value={kronor(p.priceOre)} />
        ),
    },
    {
      // Selling under cost is the board's call, so it is marked and not refused.
      key: "status",
      header: t("col.status"),
      value: (p) => (under(p) ? 1 : 0),
      sortable: true,
      mobile: "status",
      cell: (p) => (under(p) ? <Tag tone="warning">{t("underCost")}</Tag> : null),
    },
    {
      key: "since",
      header: t("col.since"),
      className: "tabular-nums whitespace-nowrap",
      value: (p) => p.validFrom ?? "",
      sortable: true,
      mobile: "meta",
      cell: (p) => (
        <>
          {p.validFrom ? date(p.validFrom) : <span className="text-muted">-</span>}
          {p.next && (
            <span className="block text-xs text-muted">
              {t("next", { price: kr(p.next.priceOre), date: date(p.next.validFrom) })}
            </span>
          )}
        </>
      ),
    },
    {
      key: "edit",
      header: "",
      align: "right",
      hidden: !canManage,
      mobile: "actions",
      cell: (p) => (
        <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
          {p.priceOre == null ? t("set") : t("change")}
        </Button>
      ),
    },
  ];

  return (
    <PageShell title={t("title")} width="content">
      <Card>
        <ClientDataTable
          columns={columns}
          rows={prices}
          controls={controls}
          rowKey={(p) => p.productId}
          searchPlaceholder={t("search")}
          empty={t("empty")}
        />
      </Card>
      {editing && <PriceDialog price={editing} today={today} onClose={() => setEditing(null)} />}
    </PageShell>
  );
}

const under = (p: BoardPriceDto) =>
  p.priceOre != null && p.costPriceOre != null && p.priceOre < p.costPriceOre;

function PriceDialog({
  price,
  today,
  onClose,
}: {
  price: BoardPriceDto;
  today: string;
  onClose: () => void;
}) {
  const t = useTranslations("board.prices");
  const { pending, mutate } = useMutation();
  const [amount, setAmount] = useState(price.priceOre == null ? "" : String(price.priceOre / 100));
  const [from, setFrom] = useState(today);

  const typed = Number(amount.replace(",", "."));
  const valid = amount.trim() !== "" && Number.isFinite(typed) && typed >= 0;
  const ore = valid ? sekToOre(typed) : 0;
  const under = valid && price.costPriceOre != null && ore < price.costPriceOre;
  const blocker = !valid ? t("dialog.priceRequired") : !from ? t("dialog.dateRequired") : null;

  async function save() {
    const body: SetBoardPrice = { productId: price.productId, priceOre: ore, validFrom: from };
    const done = await mutate("/api/board/prices", {
      body,
      error: t("saveFailed"),
      success: t("saved"),
    });
    if (done !== null) onClose();
  }

  return (
    <Modal label={price.name} onClose={onClose} className="max-w-md">
      <ModalHeader title={price.name} subtitle={t("dialog.hint")} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-inset py-4">
        <Field
          label={t("dialog.price")}
          // A warning, not a refusal: selling under cost is the board's call to make.
          hint={
            under
              ? t("dialog.underCost", { cost: kr(price.costPriceOre!) })
              : price.costPriceOre != null
                ? t("dialog.cost", { cost: kr(price.costPriceOre) })
                : undefined
          }
          requirement="required"
        >
          <AmountInput value={amount} onChange={setAmount} />
        </Field>
        <Field label={t("dialog.from")} hint={t("dialog.fromHint")} requirement="required">
          <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        {price.history.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted">{t("dialog.history")}</p>
            <ul className="space-y-0.5 text-xs text-muted">
              {price.history.map((h) => (
                <li key={h.validFrom} className="flex justify-between tabular-nums">
                  <span>
                    {h.validFrom} ({h.by})
                  </span>
                  <span>{kr(h.priceOre)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <ModalFooter blocker={blocker}>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={Boolean(blocker)} loading={pending !== null}>
            {t("save")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
