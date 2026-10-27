"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { useMutation } from "@/components/shell/use-mutation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Field, Input, Textarea } from "@/components/ui/field";
import { IconChevronDown } from "@/components/ui/icons";
import { IconButton } from "@/components/ui/icon-button";
import { Tag } from "@/components/ui/status-pill";
import type { TemplateItemBody, TemplateMoveBody } from "@/lib/api/schemas/closing";
import { CLOSING_CHECKS } from "@/lib/closing/checklist";
import type { TemplateItem } from "@/lib/data/closing-checklist";
import { ROLES } from "@/lib/domain/permissions";
import type { ClosingCheck, Role } from "@/lib/domain/types";
import { cn } from "@/lib/ui/utils";

/** The editable fields of a step, as the form holds them. */
interface Draft {
  title: string;
  howTo: string;
  ownerRole: string;
  dueOffsetDays: string;
  check: string;
}

const draftOf = (i?: TemplateItem): Draft => ({
  title: i?.title ?? "",
  howTo: i?.howTo ?? "",
  ownerRole: i?.ownerRole ?? "",
  dueOffsetDays: i?.dueOffsetDays == null ? "" : String(i.dueOffsetDays),
  check: i?.check ?? "",
});

const bodyOf = (d: Draft): TemplateItemBody => ({
  title: d.title,
  howTo: d.howTo,
  ownerRole: (d.ownerRole || null) as Role | null,
  dueOffsetDays: d.dueOffsetDays.trim() === "" ? null : Number(d.dueOffsetDays),
  check: (d.check || null) as ClosingCheck | null,
});

export default function TemplateClient({
  items,
  canEdit,
}: {
  items: TemplateItem[];
  canEdit: boolean;
}) {
  const t = useTranslations("closing.template");
  const active = items.filter((i) => i.active);
  const retired = items.filter((i) => !i.active);

  return (
    <PageShell title={t("title")} back="/closing" width="content">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader subtitle={t("intro")} />
          <ul className="divide-y divide-border">
            {active.map((item, i) => (
              <TemplateRow
                key={item.id}
                item={item}
                canEdit={canEdit}
                first={i === 0}
                last={i === active.length - 1}
              />
            ))}
          </ul>
        </Card>

        {canEdit && <NewStep />}

        {retired.length > 0 && (
          <Card>
            <CardHeader title={t("retired")} />
            <ul className="divide-y divide-border">
              {retired.map((item) => (
                <TemplateRow key={item.id} item={item} canEdit={canEdit} first last />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </PageShell>
  );
}

function TemplateRow({
  item,
  canEdit,
  first,
  last,
}: {
  item: TemplateItem;
  canEdit: boolean;
  first: boolean;
  last: boolean;
}) {
  const t = useTranslations("closing.template");
  const tRole = useTranslations("common.role");
  const tCheck = useTranslations("closing.check");
  const { pending, mutate } = useMutation();
  const url = `/api/closing/template/${item.id}`;

  const move = (direction: TemplateMoveBody["direction"]) =>
    mutate(`${url}/move`, { key: direction, body: { direction }, error: t("saveFailed") });

  return (
    <li className="flex gap-3 px-inset py-3">
      <details className="min-w-0 flex-1">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
          <span className={cn("font-medium break-words", !item.active && "text-muted")}>
            {item.title}
          </span>
          {item.ownerRole && <Tag size="sm">{tRole(item.ownerRole)}</Tag>}
          {item.dueOffsetDays !== null && (
            <span className="text-xs text-muted">{t("offset", { days: item.dueOffsetDays })}</span>
          )}
          {item.check && (
            <Tag tone="blue" size="sm">
              {tCheck(item.check)}
            </Tag>
          )}
        </summary>
        <div className="mt-3">
          {canEdit ? (
            <StepForm
              initial={draftOf(item)}
              submitLabel={t("save")}
              onSubmit={(d) =>
                mutate(url, { method: "PATCH", key: "save", body: bodyOf(d), error: t("saveFailed") })
              }
              busy={pending === "save"}
              extra={
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending === "active"}
                  onClick={() =>
                    mutate(url, {
                      method: "PATCH",
                      key: "active",
                      body: { active: !item.active },
                      error: t("saveFailed"),
                    })
                  }
                >
                  {item.active ? t("retire") : t("restore")}
                </Button>
              }
            />
          ) : (
            item.howTo && <p className="whitespace-pre-wrap text-sm text-muted">{item.howTo}</p>
          )}
        </div>
      </details>
      {canEdit && item.active && (
        <div className="flex shrink-0 items-start gap-1">
          <IconButton
            label={t("moveUp")}
            disabled={first}
            loading={pending === "up"}
            onClick={() => move("up")}
          >
            <IconChevronDown className="size-4 rotate-180" />
          </IconButton>
          <IconButton
            label={t("moveDown")}
            disabled={last}
            loading={pending === "down"}
            onClick={() => move("down")}
          >
            <IconChevronDown className="size-4" />
          </IconButton>
        </div>
      )}
    </li>
  );
}

function NewStep() {
  const t = useTranslations("closing.template");
  const { pending, mutate } = useMutation();
  // A new key after each save starts the form over empty.
  const [round, setRound] = useState(0);

  return (
    <Card>
      <CardHeader title={t("add")} />
      <CardBody>
        <StepForm
          key={round}
          initial={draftOf()}
          submitLabel={t("addSubmit")}
          busy={pending === "add"}
          onSubmit={async (d) => {
            const res = await mutate("/api/closing/template", {
              key: "add",
              body: bodyOf(d),
              error: t("saveFailed"),
            });
            if (res) setRound((r) => r + 1);
          }}
        />
      </CardBody>
    </Card>
  );
}

function StepForm({
  initial,
  submitLabel,
  onSubmit,
  busy,
  extra,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (d: Draft) => unknown;
  busy: boolean;
  extra?: React.ReactNode;
}) {
  const t = useTranslations("closing.template");
  const tRole = useTranslations("common.role");
  const tCheck = useTranslations("closing.check");
  const [d, setD] = useState(initial);
  const set = (k: keyof Draft) => (v: string) => setD((prev) => ({ ...prev, [k]: v }));
  const offsetOk = d.dueOffsetDays.trim() === "" || /^-?\d{1,3}$/.test(d.dueOffsetDays.trim());

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (d.title.trim() && offsetOk) void onSubmit(d);
      }}
    >
      <Field label={t("field.title")}>
        <Input value={d.title} onChange={(e) => set("title")(e.target.value)} />
      </Field>
      <Field label={t("field.howTo")} hint={t("field.howToHint")}>
        <Textarea value={d.howTo} onChange={(e) => set("howTo")(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("field.ownerRole")}>
          <Combobox
            value={d.ownerRole}
            onChange={set("ownerRole")}
            allowClear
            placeholder={t("field.noOwner")}
            searchable={false}
            options={ROLES.map((r) => ({ value: r, label: tRole(r) }))}
          />
        </Field>
        <Field
          label={t("field.dueOffsetDays")}
          hint={t("field.dueOffsetDaysHint")}
          error={offsetOk ? undefined : t("field.dueOffsetDaysInvalid")}
        >
          <Input
            inputMode="numeric"
            value={d.dueOffsetDays}
            onChange={(e) => set("dueOffsetDays")(e.target.value)}
          />
        </Field>
        <Field label={t("field.check")} hint={t("field.checkHint")}>
          <Combobox
            value={d.check}
            onChange={set("check")}
            allowClear
            placeholder={t("field.noCheck")}
            searchable={false}
            options={CLOSING_CHECKS.map((c) => ({ value: c, label: tCheck(c) }))}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={!d.title.trim() || !offsetOk}>
          {submitLabel}
        </Button>
        {extra}
      </div>
    </form>
  );
}
