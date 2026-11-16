"use client";

// Logga: the same sheet as Flytta, with the board price on each row and the sum on the button. What is typed is
// kept in the browser until it is saved, like Flytta's. Below it what the reader wrote down today, to take back a slip.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { PinnedBar } from "@/components/action-bar";
import { PageShell } from "@/components/page-shell";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { BarcodeScanner } from "@/components/stock/barcode-scanner";
import { SearchScanRow, StepperRow } from "@/components/stock/product-stepper";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DateInput, Field } from "@/components/ui/field";
import type { CreateBoardWithdrawal } from "@/lib/api/schemas/board";
import type { BoardMemberDto, BoardWithdrawalDto } from "@/lib/data/board";
import { useFormat } from "@/lib/ui/use-format";
import { useLocalDraft } from "@/lib/ui/use-local-draft";

import { kr, kronor, useRemoveWithdrawal } from "./tab-view";

interface Product {
  id: string;
  name: string;
  ean?: string;
  priceOre: number;
  onHand: number;
}

interface Draft {
  member: string;
  /** Units per product. A product at nothing is not in here. */
  qty: Record<string, number>;
  occurredAt: string;
  /** This submit's key, kept with the draft so a retry after a lost answer is the same submit. */
  batchId: string;
}

export default function WithdrawClient({
  products,
  members,
  self,
  picked,
  loggedToday,
  today,
}: {
  products: Product[];
  /** The board, for the treasurer to pick whose tab. Null for a member logging their own. */
  members: BoardMemberDto[] | null;
  /** The reader, when they hold a tab of their own. */
  self: string | null;
  /** Whose tab, when the page was opened for somebody (a person's page under Fakturering). */
  picked: string | null;
  /** What the reader wrote down today, for themselves or anybody. */
  loggedToday: BoardWithdrawalDto[];
  today: string;
}) {
  const t = useTranslations("board");
  const router = useRouter();
  const notify = useNotify();
  const { pending, mutate } = useMutation();
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const remove = useRemoveWithdrawal();
  const { date } = useFormat();

  const [draft, setDraft] = useLocalDraft<Draft>("board:withdraw:draft", {
    member: self ?? "",
    qty: {},
    occurredAt: today,
    batchId: "",
  });
  // Opened for somebody, that person until another is picked. Else the draft's, read through the list since it can
  // name somebody gone from the board.
  const [pick, setPick] = useState(picked);
  const known = (id: string | null) => members?.some((m) => m.id === id) ?? false;
  const member = members
    ? known(pick)
      ? pick!
      : known(draft.member)
        ? draft.member
        : ""
    : (self ?? "");

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  /** Set one product's figure, held between nothing and what the shelf holds. */
  function set(id: string, units: number) {
    const product = byId.get(id);
    if (!product) return;
    const held = Math.max(0, Math.min(Math.round(units), Math.max(0, product.onHand)));
    setDraft((d) => {
      const qty = { ...d.qty };
      if (held > 0) qty[id] = held;
      else delete qty[id];
      return { ...d, qty, batchId: d.batchId || crypto.randomUUID() };
    });
  }

  const lines = Object.entries(draft.qty)
    .filter(([id, qty]) => qty > 0 && byId.has(id))
    .map(([productId, qty]) => ({ productId, qty: Math.min(qty, byId.get(productId)!.onHand) }))
    .filter((l) => l.qty > 0);
  const total = lines.reduce((sum, l) => sum + l.qty * byId.get(l.productId)!.priceOre, 0);

  const q = query.trim().toLowerCase();
  const shown = q
    ? products.filter((p) => p.name.toLowerCase().includes(q) || p.ean?.includes(q))
    : products;

  // Matched here, not by the stock's lookup, which a board member may not read. A scanned can goes up by one.
  function scanned(ean: string) {
    setScanning(false);
    const product = products.find((p) => p.ean === ean);
    if (!product) {
      notify.error(t("withdraw.scanUnknown"));
      return;
    }
    set(product.id, (draft.qty[product.id] ?? 0) + 1);
  }

  async function save() {
    if (lines.length === 0 || !member) return;
    const body: CreateBoardWithdrawal = {
      batchId: draft.batchId || crypto.randomUUID(),
      occurredAt: draft.occurredAt || today,
      lines,
      memberId: members ? member : undefined,
    };
    const done = await mutate("/api/board/withdrawals", {
      key: "save",
      body,
      error: t("saveFailed"),
      refresh: false,
    });
    if (done === null) return;
    // The member is kept: the treasurer logging a pile of slips is most likely on the same person.
    setDraft((d) => ({ ...d, member, qty: {}, batchId: "", occurredAt: today }));
    notify.success(t("saved", { amount: kr(total) }));
    router.refresh();
  }

  return (
    <PageShell title={t("log.title")} width="content">
      {/* Room at the bottom for the bar that carries the button, which is docked on a phone. */}
      <div className="space-y-4 pb-28 md:pb-0">
        {members && (
          <Field label={t("withdraw.member")}>
            <Combobox
              value={member}
              onChange={(next) => {
                setPick(null);
                setDraft((d) => ({ ...d, member: next }));
              }}
              options={members.map((m) => ({ value: m.id, label: m.name }))}
              placeholder={t("withdraw.pickMember")}
              aria-label={t("withdraw.member")}
              searchable
            />
          </Field>
        )}

        <SearchScanRow
          query={query}
          onQuery={setQuery}
          placeholder={t("withdraw.search")}
          onScan={() => setScanning(true)}
        />

        <Card>
          {shown.length === 0 ? (
            <p className="px-inset py-6 text-center text-sm text-muted">
              {products.length === 0 ? t("withdraw.noProducts") : t("withdraw.noMatch")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((p) => (
                <StepperRow
                  key={p.id}
                  name={p.name}
                  detail={kr(p.priceOre)}
                  units={Math.min(draft.qty[p.id] ?? 0, p.onHand)}
                  max={p.onHand}
                  onChange={(units) => set(p.id, units)}
                />
              ))}
            </ul>
          )}
        </Card>

        {loggedToday.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted">{t("log.today")}</h2>
            <Card>
              <ul className="divide-y divide-border">
                {loggedToday.map((w) => (
                  <li key={w.id} className="flex items-center gap-3 px-inset py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{w.productName}</p>
                      <p className="truncate text-xs text-muted">
                        {[
                          t("tab.units", { count: w.qty }),
                          w.memberId !== self && w.memberName,
                          w.date !== today && date(w.date),
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    </div>
                    <Amount value={kronor(w.amountOre)} />
                    {!w.invoiced && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={remove.pending === `remove:${w.id}`}
                        onClick={() => remove.run(w)}
                      >
                        {t("remove")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}
      </div>

      {/* The one button, docked within a thumb's reach on a phone. */}
      <PinnedBar phone="dock">
        <div className="mx-auto flex max-w-xl items-center gap-3 md:max-w-none">
          {/* In a fixed box: the field is full width by default, and in this row it took the button's room. */}
          <div className="w-40 shrink-0">
            <DateInput
              size="sm"
              value={draft.occurredAt || today}
              max={today}
              onChange={(e) => setDraft((d) => ({ ...d, occurredAt: e.target.value }))}
              aria-label={t("withdraw.date")}
            />
          </div>
          {/* The sum beside the button, so the button keeps a short label on a narrow phone. */}
          <Amount value={kronor(total)} size="md" className="ml-auto shrink-0" />
          <Button
            className="min-w-0 flex-1 md:flex-none"
            disabled={lines.length === 0 || !member}
            loading={pending === "save"}
            onClick={save}
          >
            <span className="truncate">
              {lines.length === 0
                ? t("withdraw.saveEmpty")
                : !member
                  ? t("withdraw.pickMember")
                  : t("withdraw.save")}
            </span>
          </Button>
        </div>
      </PinnedBar>

      {scanning && <BarcodeScanner onCode={scanned} onCancel={() => setScanning(false)} />}
    </PageShell>
  );
}
