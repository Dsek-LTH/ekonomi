"use client";

// Settings → Milersättning. What a kilometre is worth, and from which day.
//
// A table rather than a constant in the code because the figure is
// Skatteverket's and moves at a new year, and a deploy is the wrong way to find
// that out. Safe to edit for the reason stated on the screen itself: a journey
// stores the rate it was valued at, so nothing here re-values a claim already
// filed — see the Milersättning block on Expense in the schema.
//
// The rate is entered per *mil*, which is how it is quoted everywhere outside
// this app, and stored per kilometre, which is how everything inside it
// calculates. That conversion happens here and nowhere else.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyNote } from "@/components/ui/empty-state";
import { Field, Input, DateInput } from "@/components/ui/field";
import { Tag } from "@/components/ui/status-pill";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { isAmountInput, parseSEK } from "@/lib/domain/money";
import { rateOn } from "@/lib/mileage/rate";
import { today } from "@/lib/domain/date";
import type { MileageRateRow } from "@/lib/data/mileage";
import type { MileageRateInput } from "@/lib/api/schemas/admin";

// One formatter for both, built once rather than per row per render —
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
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();

  const [adding, setAdding] = useState(false);
  const [krPerMil, setKrPerMil] = useState("");
  const [validFrom, setValidFrom] = useState("");
  // Optional, and worth having: the table is read a year later by somebody
  // asking why the figure changed, and "Skatteverkets schablon 2026" is the
  // whole answer. The column and the message keys were always here — only the
  // field to type it into was missing, so the note could be read and never set.
  const [note, setNote] = useState("");

  // Which row is the one actually in force today, so the table says so rather
  // than leaving it to be worked out from the dates. The same function the
  // claims are valued with, so the badge cannot disagree with the arithmetic.
  const current = rateOn(rates, today());

  async function add() {
    const kr = parseSEK(krPerMil);
    if (!(kr > 0) || !validFrom) return;
    // Kronor per mil in, öre per kilometre out — a mil is ten kilometres, and
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

  return (
    <Card>
      <CardHeader
        title={t("title")}
        subtitle={t("description")}
        action={
          <Button size="sm" onClick={() => setAdding((v) => !v)}>
            <IconPlus className="size-4" />
            {t("new")}
          </Button>
        }
      />

      {adding && (
        // The form sits above the table rather than in a dialog: it is two
        // fields, and a new rate is read straight after it is entered — the row
        // appearing at the top of the list below is the confirmation.
        <div className="grid gap-4 border-b border-border px-5 py-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-end">
          <Field label={t("validFrom")}>
            <DateInput value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label={t("rate")} hint={t("rateHint")}>
            <Input
              inputMode="decimal"
              value={krPerMil}
              onChange={(e) => {
                if (!isAmountInput(e.target.value)) return;
                setKrPerMil(e.target.value);
              }}
            />
          </Field>
          <Field label={t("note")}>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
            />
          </Field>
          <Button
            onClick={add}
            loading={pending === "new-rate"}
            disabled={!validFrom || !(parseSEK(krPerMil) > 0)}
          >
            {t("save")}
          </Button>
        </div>
      )}

      {rates.length === 0 ? (
        <EmptyNote>{t("empty")}</EmptyNote>
      ) : (
        <ul className="divide-y divide-border">
          {rates.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">
                    {t("perMil", { amount: perMil(r.orePerKm) })}
                  </span>
                  <span className="text-xs text-muted tabular-nums">
                    {t("perKm", { amount: perKm(r.orePerKm) })}
                  </span>
                  {current?.validFrom === r.validFrom && <Tag tone="success">{t("current")}</Tag>}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {t("col.validFrom")} {r.validFrom}
                  {r.note ? ` · ${r.note}` : ""}
                  {r.createdBy ? ` · ${t("col.createdBy")} ${r.createdBy}` : ""}
                </p>
              </div>
              <IconButton tone="danger" label={t("remove")} onClick={() => remove(r)}>
                <IconTrash className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
