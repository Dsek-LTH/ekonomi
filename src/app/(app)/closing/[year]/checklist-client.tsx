"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { useMutation } from "@/components/shell/use-mutation";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Textarea } from "@/components/ui/field";
import { IconCheck } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { Tag } from "@/components/ui/status-pill";
import type { ChecklistItemPatch } from "@/lib/api/schemas/closing";
import { isItemDone } from "@/lib/closing/checklist";
import type { ClosingYear } from "@/lib/data/closing";
import type { ChecklistEntry } from "@/lib/data/closing-checklist";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import { closingSections } from "../sections";

export default function ChecklistClient({
  year,
  items,
  canWork,
  canEditTemplate,
}: {
  year: ClosingYear;
  /** Null until the year's checklist has been started. */
  items: ChecklistEntry[] | null;
  /** May tick items and write their notes. */
  canWork: boolean;
  canEditTemplate: boolean;
}) {
  const t = useTranslations("closing");
  const tList = useTranslations("closing.checklist");
  const { dateTime } = useFormat();
  const { pending, mutate } = useMutation();

  const done = items?.filter((i) => isItemDone(i)).length ?? 0;

  return (
    <PageShell
      title={t("yearTitle", { year: year.year })}
      subtitle={
        year.lastSyncAt ? t("lastSync", { when: dateTime(year.lastSyncAt) }) : t("neverSynced")
      }
      back="/closing"
      collections={closingSections({
        yearId: year.id,
        active: "checklist",
        label: t("sections.label"),
        labels: {
          checklist: t("sections.checklist"),
          vouchers: t("sections.vouchers"),
          accounts: t("sections.accounts"),
        },
      })}
    >
      {items === null ? (
        <EmptyState
            title={tList("notStarted")}
            description={tList("notStartedBody")}
            action={
              canWork ? (
                <Button
                  loading={pending === "start"}
                  onClick={() =>
                    mutate(`/api/closing/${year.id}/checklist`, {
                      key: "start",
                      error: tList("startFailed"),
                    })
                  }
                >
                  {tList("start")}
                </Button>
              ) : undefined
            }
          />
      ) : (
        <Card>
          <CardHeader
            subtitle={tList("progress", { done, total: items.length })}
            action={
              canEditTemplate ? (
                <ButtonLink href="/closing/template" size="sm" variant="secondary">
                  {tList("editTemplate")}
                </ButtonLink>
              ) : undefined
            }
          />
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <ChecklistRow key={item.id} yearId={year.id} item={item} canWork={canWork} />
            ))}
          </ul>
        </Card>
      )}
    </PageShell>
  );
}

function ChecklistRow({
  yearId,
  item,
  canWork,
}: {
  yearId: number;
  item: ChecklistEntry;
  canWork: boolean;
}) {
  const t = useTranslations("closing.checklist");
  const tRole = useTranslations("common.role");
  const { date, dateTime } = useFormat();
  const { pending, mutate } = useMutation();
  const [note, setNote] = useState(item.note);
  const [toNext, setToNext] = useState(item.noteToNextYear);

  const isDone = isItemDone(item);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !isDone && item.dueDate !== null && item.dueDate < today;
  const url = `/api/closing/${yearId}/checklist/${item.id}`;

  const patch = (body: ChecklistItemPatch, key: string) =>
    mutate(url, { method: "PATCH", key, body, error: t("saveFailed") });

  return (
    <li className="flex gap-3 px-inset py-3">
      <div className="pt-0.5">
        {item.check || !canWork ? (
          // Answered by the app, or read by somebody who does not tick: a mark,
          // not a control.
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full border",
              isDone ? "border-success bg-success text-on-brand" : "border-border",
            )}
            aria-label={isDone ? t("done") : t("open")}
          >
            {isDone && <IconCheck className="size-3.5" />}
          </span>
        ) : (
          <Checkbox
            checked={isDone}
            label={item.title}
            onChange={() => patch({ done: !isDone }, "done")}
          />
        )}
      </div>

      <details className="group min-w-0 flex-1">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
          <span className={cn("font-medium break-words", isDone && "text-muted line-through")}>
            {item.title}
          </span>
          {item.ownerRole && <Tag size="sm">{tRole(item.ownerRole)}</Tag>}
          {item.dueDate && (
            <span className={cn("text-xs", overdue ? "text-danger" : "text-muted")}>
              {t("due", { date: date(item.dueDate) })}
            </span>
          )}
          {item.check && (
            <span className="text-xs text-muted">
              {item.check.remaining === 0
                ? t("checkDone")
                : t("checkRemaining", { count: item.check.remaining })}
            </span>
          )}
          {!item.check && item.doneAt && (
            <span className="text-xs text-muted">
              {t("doneBy", { name: item.doneBy ?? t("someone"), when: dateTime(item.doneAt) })}
            </span>
          )}
          {item.fromLastYear && (
            <Tag tone="blue" size="sm">
              {t("hasNoteFromLastYear")}
            </Tag>
          )}
        </summary>

        <div className="mt-3 flex flex-col gap-4 text-sm">
          {item.fromLastYear && (
            <Notice tone="info">
              <p className="font-medium">{t("fromLastYear")}</p>
              <p className="whitespace-pre-wrap">{item.fromLastYear}</p>
            </Notice>
          )}
          {item.howTo && <p className="whitespace-pre-wrap text-muted">{item.howTo}</p>}
          {item.check?.href && item.check.remaining > 0 && (
            <div>
              <ButtonLink href={item.check.href} size="sm" variant="secondary">
                {t("goToCheck")}
              </ButtonLink>
            </div>
          )}

          {canWork ? (
            <>
              <Field label={t("note")} hint={t("noteHint")}>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={() => note.trim() !== item.note && patch({ note }, "note")}
                  aria-busy={pending === "note" || undefined}
                />
              </Field>
              <Field label={t("noteToNextYear")} hint={t("noteToNextYearHint")}>
                <Textarea
                  value={toNext}
                  onChange={(e) => setToNext(e.target.value)}
                  onBlur={() =>
                    toNext.trim() !== item.noteToNextYear &&
                    patch({ noteToNextYear: toNext }, "noteToNextYear")
                  }
                  aria-busy={pending === "noteToNextYear" || undefined}
                />
              </Field>
            </>
          ) : (
            <>
              {item.note && (
                <div>
                  <p className="text-xs font-medium text-muted">{t("note")}</p>
                  <p className="whitespace-pre-wrap">{item.note}</p>
                </div>
              )}
              {item.noteToNextYear && (
                <div>
                  <p className="text-xs font-medium text-muted">{t("noteToNextYear")}</p>
                  <p className="whitespace-pre-wrap">{item.noteToNextYear}</p>
                </div>
              )}
            </>
          )}
        </div>
      </details>
    </li>
  );
}
