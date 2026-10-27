"use client";

// Settings → Milersättning. What a kilometre is worth, and from which day.
//
// A table rather than a constant in the code because the figure is
// Skatteverket's and moves at a new year, and a deploy is the wrong way to find
// that out. Safe to edit for the reason stated on the screen itself: a journey
// stores the rate it was valued at, so nothing here re-values a claim already
// filed. See the Milersättning block on Expense in the schema.
//
// The rate is entered per *mil*, which is how it is quoted everywhere outside
// this app, and stored per kilometre, which is how everything inside it
// calculates. That conversion happens here and nowhere else.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Field, Input, DateInput } from "@/components/ui/field";
import { Tag } from "@/components/ui/status-pill";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { parseSEK } from "@/lib/domain/money";
import { AmountInput } from "@/components/ui/amount-input";
import { ExpandToggle } from "@/components/ui/expand-toggle";
import { rateOn } from "@/lib/mileage/rate";
import { today } from "@/lib/domain/date";
import { useFormat } from "@/lib/ui/use-format";
import type { MileageRateRow } from "@/lib/data/mileage";
import type { MileageRateInput } from "@/lib/api/schemas/admin";

// One formatter for both, built once rather than per row per render:
// constructing an Intl formatter is the expensive half of using one.
const kr = new Intl.NumberFormat("sv-SE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 250 öre/km → "25,00", the way it is quoted. One mil is ten kilometres. */
const perMil = (orePerKm: number) => kr.format((orePerKm * 10) / 100);

const perKm = (orePerKm: number) => kr.format(orePerKm / 100);

export function MileageRatesClient({ rates }: { rates: MileageRateRow[] }) {
  const t = useTranslations("mileage.rates");
  const tCommon = useTranslations("common");
  const { date } = useFormat();
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();

  const [adding, setAdding] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [krPerMil, setKrPerMil] = useState("");
  const [validFrom, setValidFrom] = useState("");
  // Optional, and worth having: the table is read a year later by somebody
  // asking why the figure changed, and "Skatteverkets schablon 2026" is the
  // whole answer.
  const [note, setNote] = useState("");

  // The page is one number most of the year: the rate in force today. So that
  // is what it leads with, and the rest is split by when it applies. A rate
  // dated ahead is shown beside it, since it is about to matter. The ones it
  // replaced are history, folded away until asked for. The same function the
  // claims are valued with picks the current one, so the page cannot disagree
  // with the arithmetic.
  const day = today();
  // rateOn hands back the row it was given, typed as the narrower shape it
  // reads, so it is looked up again to keep the row's own fields.
  const inForce = rateOn(rates, day);
  const current = inForce ? rates.find((r) => r.validFrom === inForce.validFrom) ?? null : null;
  const upcoming = rates.filter((r) => r.validFrom > day);
  const earlier = rates.filter((r) => r.validFrom <= day && r.id !== current?.id);

  async function add() {
    const kr = parseSEK(krPerMil);
    if (!(kr > 0) || !validFrom) return;
    // Kronor per mil in, öre per kilometre out. A mil is ten kilometres, and
    // the rounding is here so the stored integer is exact rather than a float
    // that happens to print well.
    const body: MileageRateInput = {
      orePerKm: Math.round((kr * 100) / 10),
      validFrom,
      note: note.trim() || null,
    };
    const saved = await mutate("/api/mileage/rates", {
      key: "new-rate",
      body,
      error: t("saveFailed"),
      success: t("saved"),
    });
    if (!saved) return;
    setKrPerMil("");
    setValidFrom("");
    setNote("");
    setAdding(false);
  }

  async function remove(rate: MileageRateRow) {
    const ok = await confirm({
      title: t("removeTitle"),
      message: t("removeDescription"),
      confirmLabel: t("remove"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/mileage/rates/${rate.id}`, {
      key: rate.id,
      method: "DELETE",
      error: t("removeFailed"),
      success: t("removed"),
    });
  }

  /** Who entered it and why, on one quiet line. */
  function details(r: MileageRateRow) {
    return [r.note, r.createdBy && `${t("col.createdBy")} ${r.createdBy}`].filter(Boolean).join(" - ");
  }

  function row(r: MileageRateRow, label: string) {
    const meta = details(r);
    return (
      <li key={r.id} className="flex items-center gap-3 border-b border-border px-inset py-2.5 last:border-0">
        <span className="w-36 shrink-0 text-sm text-muted">{label}</span>
        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium tabular-nums">{t("perMil", { amount: perMil(r.orePerKm) })}</span>
          {meta && <span className="ml-2 text-xs text-muted">{meta}</span>}
        </span>
        <IconButton tone="danger" label={t("remove")} loading={pending === r.id} onClick={() => remove(r)}>
          <IconTrash className="size-4" />
        </IconButton>
      </li>
    );
  }

  return (
    <Card>
      {/* The rate in force, as the headline. The button beside it opens the
          form directly under it. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-inset py-4">
        {current ? (
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-2xl font-semibold tabular-nums tracking-tight">
                {t("perMil", { amount: perMil(current.orePerKm) })}
              </span>
              <span className="text-sm text-muted tabular-nums">
                {t("perKm", { amount: perKm(current.orePerKm) })}
              </span>
              <Tag tone="success">{t("current")}</Tag>
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {[t("since", { date: date(current.validFrom) }), details(current)].filter(Boolean).join(" - ")}
            </p>
          </div>
        ) : (
          // Without one, no mileage claim can be filed, which is worth more
          // than a muted empty state.
          <p className="min-w-0 flex-1 text-sm text-warning">{t("empty")}</p>
        )}
        <div className="flex items-center gap-1">
          {!adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <IconPlus className="size-4" />
              {t("new")}
            </Button>
          )}
          {/* Still removable: a rate entered with the wrong figure today is
              the current one, and has to be taken back from here. */}
          {current && (
            <IconButton
              tone="danger"
              label={t("remove")}
              loading={pending === current.id}
              onClick={() => remove(current)}
            >
              <IconTrash className="size-4" />
            </IconButton>
          )}
        </div>
      </div>

      {adding && (
        <div className="grid gap-4 border-t border-border bg-surface px-inset py-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,10rem)_minmax(0,1fr)] sm:items-start">
          <Field label={t("validFrom")} requirement="required">
            <DateInput size="sm" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label={t("rate")} hint={t("rateHint")} requirement="required">
            {/* A schablon is never negative, so no sign button, but the
                separator is the same problem it is everywhere: a phone offers
                the one its own locale uses. */}
            <AmountInput size="sm" value={krPerMil} onChange={setKrPerMil} />
          </Field>
          <Field label={t("note")} requirement="optional">
            <Input
              size="sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
            />
          </Field>
          <div className="flex gap-2 sm:col-span-3">
            <Button
              size="sm"
              onClick={add}
              loading={pending === "new-rate"}
              disabled={!validFrom || !(parseSEK(krPerMil) > 0)}
            >
              {t("save")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
              {tCommon("cancel")}
            </Button>
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <ul className="border-t border-border">
          {upcoming.map((r) => row(r, t("from", { date: date(r.validFrom) })))}
        </ul>
      )}

      {earlier.length > 0 && (
        <div className="border-t border-border">
          <div className="px-inset py-2">
            <ExpandToggle open={showHistory} onToggle={() => setShowHistory(!showHistory)} className="-ml-2">
              {showHistory ? t("hideEarlier") : t("showEarlier", { count: earlier.length })}
            </ExpandToggle>
          </div>
          {showHistory && (
            <ul className="border-t border-border">
              {earlier.map((r) => row(r, t("from", { date: date(r.validFrom) })))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
