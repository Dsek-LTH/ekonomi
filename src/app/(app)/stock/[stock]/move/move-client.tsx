"use client";

// Flytta: stock carried between storage and the stock's places, logged on a phone. A refill is storage to a fridge,
// a committee taking sodas for a shift is storage to its place, and what it brings back is its place to wherever it
// is put. One list, the usual products on top, a stepper each, and one button. Nothing is written until the button,
// and what is typed is kept in the browser until it has been, so a dead spot between the shelves loses nothing.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { PinnedBar } from "@/components/action-bar";
import { PageShell } from "@/components/page-shell";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { SearchScanRow, StepperRow } from "@/components/stock/product-stepper";
import { useProductScan } from "@/components/stock/use-product-scan";
import { useStock } from "@/components/stock/stock-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DateInput, Field } from "@/components/ui/field";
import type { CreateStockMove } from "@/lib/api/schemas/stock";
import type { MoveBatchDto, MoveProductDto, StockPlaceDto } from "@/lib/data/stock";
import { useLocalDraft } from "@/lib/ui/use-local-draft";

/** Storage, called Mauer, in the pickers. Not a place: it is what the log's sum is, and nobody holds it. */
const STORAGE = "storage";

interface Draft {
  from: string;
  to: string;
  /** Units per product. A product at nothing is not in here. */
  qty: Record<string, number>;
  occurredAt: string;
  /** This submit's key, kept with the draft so a retry after a lost answer is the same submit. */
  batchId: string;
}

const newBatchId = () => crypto.randomUUID();

export default function MoveClient({
  products,
  places,
  batches,
  today,
}: {
  products: MoveProductDto[];
  places: StockPlaceDto[];
  /** What this person has logged today, newest first. */
  batches: MoveBatchDto[];
  today: string;
}) {
  const t = useTranslations("stock.move");
  const { stock } = useStock();
  const router = useRouter();
  const notify = useNotify();
  const { pending, mutate } = useMutation();
  const [query, setQuery] = useState("");

  const firstMine = places.find((p) => p.mine)?.id ?? "";
  const [draft, setDraft] = useLocalDraft<Draft>(`stock:move:draft:${stock}`, {
    from: STORAGE,
    to: firstMine,
    qty: {},
    occurredAt: today,
    batchId: "",
  });

  // The same rule as canMoveBetween: one end must be a place the reader holds (a keeper holds them all).
  const mine = (id: string) => places.some((p) => p.id === id && p.mine);
  const exists = (id: string) => id === STORAGE || places.some((p) => p.id === id);
  const allowed = (from: string, to: string) =>
    from !== to && exists(from) && exists(to) && (mine(from) || mine(to));
  const ends = [STORAGE, ...places.map((p) => p.id)];
  const nameOf = (id: string) =>
    id === STORAGE ? t("storage") : (places.find((p) => p.id === id)?.name ?? "");

  // A draft can name a place since archived, or one a group no longer grants. Read it through the rule.
  const from =
    exists(draft.from) && ends.some((to) => allowed(draft.from, to)) ? draft.from : STORAGE;
  const to = allowed(from, draft.to) ? draft.to : (ends.find((id) => allowed(from, id)) ?? "");

  /** What the chosen "Från" holds of a product: storage's shelf, or what the place has taken this year. */
  const maxOf = (p: MoveProductDto) => (from === STORAGE ? p.onHand : (p.taken[from] ?? 0));
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  /** Set one product's figure, held between nothing and what "Från" holds. */
  function set(id: string, units: number) {
    const product = byId.get(id);
    if (!product) return;
    const held = Math.max(0, Math.min(Math.round(units), Math.max(0, maxOf(product))));
    setDraft((d) => {
      const qty = { ...d.qty };
      if (held > 0) qty[id] = held;
      else delete qty[id];
      // The key is made with the first figure, so an untouched sheet holds none.
      return { ...d, from, to, qty, batchId: d.batchId || newBatchId() };
    });
  }

  /** A new "Från" holds different figures, so what was typed against the old one goes. */
  function pickFrom(next: string) {
    if (next === from) return;
    const nextTo = allowed(next, to) ? to : (ends.find((id) => allowed(next, id)) ?? "");
    setDraft((d) => ({ ...d, from: next, to: nextTo, qty: {}, batchId: "" }));
  }

  const lines = Object.entries(draft.qty)
    .filter(([id, units]) => units > 0 && byId.has(id))
    .map(([productId, units]) => ({
      productId,
      units: Math.min(units, maxOf(byId.get(productId)!)),
    }))
    .filter((l) => l.units > 0);
  const totalUnits = lines.reduce((sum, l) => sum + l.units, 0);

  // From a place, only what it has to give back is listed.
  const q = query.trim().toLowerCase();
  const offered = from === STORAGE ? products : products.filter((p) => maxOf(p) > 0);
  const shown = q
    ? offered.filter((p) => p.name.toLowerCase().includes(q) || p.ean?.includes(q))
    : offered;

  // A scanned can goes up by one, like a tap on the stepper.
  const { scan, overlay } = useProductScan({
    unknownError: t("scanUnknown"),
    onScanned: (id) => {
      const product = byId.get(id);
      if (product) set(id, (draft.qty[id] ?? 0) + 1);
    },
  });

  async function save() {
    if (lines.length === 0 || !to) return;
    const body: CreateStockMove = {
      stock,
      from: from === STORAGE ? null : from,
      to: to === STORAGE ? null : to,
      batchId: draft.batchId || newBatchId(),
      occurredAt: draft.occurredAt || today,
      lines,
    };
    const done = await mutate<{ written: number }>("/api/stock/moves", {
      key: "save",
      body,
      error: t("failed"),
      refresh: false,
    });
    if (!done) return;
    // The route is kept: the next move from the same shift is most likely the same one.
    setDraft((d) => ({ ...d, qty: {}, batchId: "", occurredAt: today }));
    notify.success(t("saved", { units: totalUnits, to: nameOf(to) }));
    router.refresh();
  }

  async function undo(batch: MoveBatchDto) {
    await mutate(`/api/stock/moves/${batch.batchId}`, {
      key: `undo:${batch.batchId}`,
      method: "DELETE",
      error: t("undoFailed"),
      success: t("undone"),
    });
  }

  const option = (id: string) => ({ value: id, label: nameOf(id) });

  return (
    <PageShell title={t("title")} width="content">
      {/* Room at the bottom for the bar that carries the button, which is docked on a phone. */}
      <div className="space-y-4 pb-28 md:pb-0">
        {places.length === 0 ? (
          <Card>
            <p className="px-inset py-6 text-center text-sm text-muted">{t("noPlaces")}</p>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("from")}>
              <Combobox
                value={from}
                onChange={pickFrom}
                options={ends.filter((id) => ends.some((other) => allowed(id, other))).map(option)}
                aria-label={t("from")}
                // Searchable whatever the count: a stock can have twenty places.
                searchable
                searchPlaceholder={t("searchPlace")}
              />
            </Field>
            <Field label={t("to")}>
              <Combobox
                value={to}
                onChange={(next) => setDraft((d) => ({ ...d, from, to: next }))}
                options={ends.filter((id) => allowed(from, id)).map(option)}
                aria-label={t("to")}
                // Searchable whatever the count: a stock can have twenty places.
                searchable
                searchPlaceholder={t("searchPlace")}
              />
            </Field>
          </div>
        )}

        <SearchScanRow query={query} onQuery={setQuery} placeholder={t("search")} onScan={scan} />

        <Card>
          {shown.length === 0 ? (
            <p className="px-inset py-6 text-center text-sm text-muted">
              {products.length === 0
                ? t("noProducts")
                : offered.length === 0
                  ? t("nothingTaken", { place: nameOf(from) })
                  : t("noMatch")}
            </p>
          ) : (
            <ul className="divide-y divide-divider">
              {shown.map((p) => {
                const max = maxOf(p);
                return (
                  <StepperRow
                    key={p.id}
                    name={p.name}
                    units={Math.min(draft.qty[p.id] ?? 0, max)}
                    max={max}
                    detail={
                      from === STORAGE
                        ? t("onHand", { units: max })
                        : t("taken", { units: max, place: nameOf(from) })
                    }
                    onChange={(units) => set(p.id, units)}
                  />
                );
              })}
            </ul>
          )}
        </Card>

        {batches.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted">{t("today")}</h2>
            <Card>
              <ul className="divide-y divide-divider">
                {batches.map((b) => (
                  <li key={b.batchId} className="flex items-start gap-3 px-inset py-3">
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="tabular-nums text-muted">
                        {new Date(b.createdAt).toLocaleTimeString("sv-SE", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Europe/Stockholm",
                        })}
                        {b.occurredAt !== today && ` (${b.occurredAt})`}
                        {" - "}
                        {t("route", {
                          from: b.from ?? t("storage"),
                          to: b.to ?? t("storage"),
                        })}
                      </p>
                      <p>{b.lines.map((l) => `${l.units} ${l.name}`).join(", ")}</p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={pending === `undo:${b.batchId}`}
                      onClick={() => undo(b)}
                    >
                      {t("undo")}
                    </Button>
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
              aria-label={t("date")}
            />
          </div>
          {/* What the button will do. A long place name ends in an ellipsis on a narrow phone. */}
          <span className="min-w-0 flex-1 truncate text-right text-sm text-muted tabular-nums">
            {lines.length === 0
              ? t("saveEmpty")
              : t("summary", { units: totalUnits, to: nameOf(to) })}
          </span>
          <Button
            className="shrink-0"
            disabled={lines.length === 0 || !to}
            loading={pending === "save"}
            onClick={save}
          >
            {t("move")}
          </Button>
        </div>
      </PinnedBar>

      {overlay}
    </PageShell>
  );
}
