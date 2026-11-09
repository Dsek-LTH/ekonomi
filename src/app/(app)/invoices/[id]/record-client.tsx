"use client";

import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Tooltip } from "@/components/ui/tooltip";
import { IconCheck, IconDots } from "@/components/ui/icons";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useProgressRouter } from "@/components/shell/route-progress";
import { today } from "@/lib/domain/date";
import { giroMismatch } from "@/lib/domain/payment-ref";
import { PAYABLE_ACCOUNT, ROUNDING_ACCOUNT, daysUntilDue } from "@/lib/domain/supplier-invoice";
import { formatSEK } from "@/lib/ui/format";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import type { FortnoxStatus } from "@/lib/domain/types";
import type { SupplierInvoiceView } from "@/lib/data/supplier-invoices";
import {
  AllocationTable,
  AttestedBy,
  InspectorSection,
  LABEL,
  StripCell,
  VoucherTable,
  type VoucherLine,
} from "@/components/record-card";
import { UncertainExport } from "../book-view";
import { DueLabel, InvoiceStatusPill, useInvoiceTitle } from "../invoice-bits";
import {
  ReturnedNotice,
  Timeline,
  useInvoicePanelDocuments,
  useReturnToInbox,
  useTransition,
  type WorkspaceProps,
} from "../invoice-shared";
import type { WorkspaceData } from "../load";

type Allocation = SupplierInvoiceView["allocations"][number];

export function InvoiceRecordClient({
  data,
  backHref,
  fortnox,
}: {
  data: WorkspaceData;
  backHref: string;
  fortnox: FortnoxStatus | null;
}) {
  const { invoice } = data;
  const title = useInvoiceTitle();
  const booked = invoice.status === "BOOKED" || invoice.status === "EXPORTED";
  const subtitle = [
    invoice.description && invoice.reference,
    booked ? invoice.supplierName : (invoice.mail?.fromName ?? invoice.receivedByName),
  ]
    .filter(Boolean)
    .join(" - ");
  return (
    <PageShell
      width="content"
      title={title(invoice)}
      subtitle={subtitle || undefined}
      back={backHref}
    >
      <InvoiceRecord {...data} backHref={backHref} fortnox={fortnox} />
    </PageShell>
  );
}

export function InvoiceMissing() {
  const t = useTranslations("invoices.detail");
  return (
    <EmptyState
      title={t("missingTitle")}
      description={t("missingDescription")}
      action={<ButtonLink href="/invoices">{t("missingAction")}</ButtonLink>}
    />
  );
}

function InvoiceRecord(
  props: WorkspaceProps & { backHref: string; fortnox: FortnoxStatus | null },
) {
  const { invoice, can, backHref, fortnox } = props;
  const tDetail = useTranslations("invoices.detail");
  const router = useProgressRouter();
  const docs = useMutation();
  const [moving, setMoving] = useState(false);
  const uncertain = invoice.exportState === "UNCERTAIN" && can.canBook;
  const documents = useInvoicePanelDocuments(invoice);

  async function uploadDocument(file: File) {
    const form = new FormData();
    form.append("file", file);
    await docs.mutate(`/api/supplier-invoices/${invoice.id}/documents`, {
      body: form,
      key: "upload",
    });
  }

  return (
    <>
      <ReceiptPanelSource
        documents={documents}
        onFile={can.canEditDocuments ? (f) => void uploadDocument(f) : undefined}
        uploading={docs.pending === "upload"}
        multiple={can.canEditDocuments}
        uploadCopy={{
          lead: tDetail("upload.lead"),
          leadShort: tDetail("upload.leadShort"),
          action: tDetail("upload.action"),
          addLabel: tDetail("upload.add"),
        }}
        emptyTitle={tDetail("noDocumentTitle")}
        emptyDescription={tDetail("noDocument")}
      />

      <ReturnedNotice invoice={invoice} />
      {can.canSend && !uncertain && <SendNotice invoice={invoice} fortnox={fortnox} />}
      {uncertain && <UncertainExport invoice={invoice} />}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-inset py-4">
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <InvoiceStatusPill status={invoice.status} />
            <WaitingOn invoice={invoice} />
          </div>
          <RecordActions
            {...props}
            sendBlocked={uncertain}
            onMove={() => setMoving(!moving)}
            onGone={() => router.push(backHref)}
          />
        </div>
        {moving && (
          <MoveSection
            invoice={invoice}
            resultUnits={props.resultUnits}
            onDone={() => setMoving(false)}
          />
        )}

        <FactStrip invoice={invoice} />

        {invoice.mail?.note && (
          <InspectorSection title={tDetail("note")}>
            <p className="whitespace-pre-line text-sm">
              <span className="font-medium">
                {invoice.mail.fromName ?? invoice.mail.fromAddress}:
              </span>{" "}
              {invoice.mail.note}
            </p>
          </InspectorSection>
        )}

        <SplitSection invoice={invoice} />

        {(invoice.status === "BOOKED" || invoice.status === "EXPORTED") && (
          <BookingSection {...props} />
        )}

        <Timeline invoice={invoice} />
      </Card>
    </>
  );
}

function WaitingOn({ invoice }: { invoice: SupplierInvoiceView }) {
  const t = useTranslations("invoices.record");
  if (
    invoice.status !== "PENDING_APPROVAL" &&
    invoice.status !== "ASSIGNED" &&
    invoice.status !== "CHANGES_REQUESTED"
  ) {
    return null;
  }
  const units =
    invoice.status === "PENDING_APPROVAL"
      ? [
          ...new Set(
            invoice.allocations
              .filter((a) => !a.approvedByName)
              .map((a) => a.resultUnit ?? a.costCenterCode),
          ),
        ]
      : [invoice.resultUnitName ?? "-"];
  return <span className="text-sm text-muted">{t("waitingFor", { units: units.join(", ") })}</span>;
}

/** Warnings before sending to Fortnox. None blocks, except a missing Fortnox connection. */
function SendNotice({
  invoice,
  fortnox,
}: {
  invoice: SupplierInvoiceView;
  fortnox: FortnoxStatus | null;
}) {
  const t = useTranslations("invoices.record");
  const tWs = useTranslations("invoices.workspace");
  const tField = useTranslations("invoices.field");
  const days = daysUntilDue(invoice.dueDate || null, today());
  const mismatch = invoice.register ? giroMismatch(invoice, invoice.register) : null;
  const notConnected = fortnox !== null && !fortnox.connected;
  if (!(days != null && days < 0) && !mismatch && !notConnected) return null;
  return (
    <Notice tone={mismatch ? "warning" : undefined}>
      <p className="font-medium">{t("sendWarningsTitle")}</p>
      <ul className="mt-1 list-disc pl-5">
        {days != null && days < 0 && <li>{t("warning.overdue", { days: -days })}</li>}
        {mismatch && (
          <li>
            {tWs("giroWarning", {
              field: tField(mismatch.field).toLowerCase(),
              invoice: mismatch.invoice,
              register: mismatch.register ?? tWs("giroNone"),
            })}
          </li>
        )}
        {notConnected && <li>{t("fortnoxNotConnected")}</li>}
      </ul>
    </Notice>
  );
}

type Action = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabledReason?: string;
  danger?: boolean;
};

function RecordActions({
  invoice,
  can,
  fortnox,
  sendBlocked,
  onMove,
  onGone,
}: WorkspaceProps & {
  fortnox: FortnoxStatus | null;
  sendBlocked: boolean;
  onMove: () => void;
  onGone: () => void;
}) {
  const t = useTranslations("invoices.record");
  const tAction = useTranslations("invoices.action");
  const tAttest = useTranslations("invoices.attest");
  const tBook = useTranslations("invoices.book");
  const tWs = useTranslations("invoices.workspace");
  const tField = useTranslations("invoices.field");
  const confirm = useConfirm();
  const router = useProgressRouter();
  const tr = useTransition(invoice.id);
  const sender = useMutation();
  const back = useReturnToInbox(invoice.id, (status) =>
    status === "RETURNED" ? onGone() : undefined,
  );
  const unit = invoice.resultUnitName ?? "-";
  const withTreasury = invoice.status === "APPROVED" || invoice.status === "BOOKED";

  async function explained(action: "request_changes" | "withdraw_attest") {
    const ok = await confirm({
      title: tAction(action),
      message: tAction(`confirm.${action}`),
      confirmLabel: tAction(action),
      comment: { label: tAction("commentLabel"), required: action === "request_changes" },
    });
    if (ok) await tr.run({ action, comment: ok.comment || undefined });
  }

  // Back to the unit that proposed the split, with every signature removed.
  async function notOurs() {
    const ok = await confirm({
      title: tAttest("notOurs"),
      message: tAttest("notOursConfirm", { unit }),
      confirmLabel: tAttest("notOurs"),
      comment: { label: tAttest("notOursLabel", { unit }), required: true },
    });
    if (ok) await tr.run({ action: "request_changes", comment: ok.comment });
  }

  async function sendBack() {
    const ok = await confirm({
      title: tBook("sendBack", { unit }),
      message: tAction("confirm.request_changes"),
      confirmLabel: tAction("request_changes"),
      comment: { label: tAction("commentLabel"), required: true },
    });
    if (ok) await tr.run({ action: "request_changes", comment: ok.comment });
  }

  async function redistribute() {
    const ok = await confirm({
      title: tAction("redistribute"),
      message: tAction("confirm.redistribute"),
      confirmLabel: tAction("redistribute"),
    });
    if (ok && (await tr.run({ action: "redistribute" })))
      router.push(`/invoices/${invoice.id}/allocate`);
  }

  // Asked first: a supplier invoice made in Fortnox cannot be taken back from here. An unknown bankgiro is named in the question.
  async function send() {
    const mismatch = invoice.register ? giroMismatch(invoice, invoice.register) : null;
    const ok = await confirm({
      title: t("send"),
      message: mismatch
        ? `${tWs("giroWarning", {
            field: tField(mismatch.field).toLowerCase(),
            invoice: mismatch.invoice,
            register: mismatch.register ?? tWs("giroNone"),
          })} ${tWs("giroConfirm")}.`
        : t("sendConfirm"),
      confirmLabel: t("send"),
      tone: mismatch ? "danger" : "default",
    });
    if (!ok) return;
    await sender.mutate(`/api/supplier-invoices/${invoice.id}/export`, {
      body: { confirmGiro: Boolean(mismatch) },
      success: tWs("exported"),
    });
  }

  const sendReason =
    fortnox && !fortnox.connected
      ? t("fortnoxNotConnected")
      : fortnox && !fortnox.session
        ? t("fortnoxNotSignedIn")
        : sendBlocked
          ? t("sendUncertain")
          : null;

  const actions = (
    [
      can.canAllocate && {
        key: "allocate",
        label: t("allocate"),
        href: `/invoices/${invoice.id}/allocate`,
      },
      can.canAttest && {
        key: "attest",
        label: tAction("attest"),
        icon: <IconCheck className="size-4" />,
        onClick: () => void tr.run({ action: "attest" }),
      },
      can.canBook &&
        invoice.status === "APPROVED" && {
          key: "book",
          label: t("book"),
          href: `/invoices/${invoice.id}/book`,
        },
      can.canSend && {
        key: "send",
        label: t("send"),
        onClick: () => void send(),
        disabledReason: sendReason ?? undefined,
      },
      can.canAttest && {
        key: "not_ours",
        label: tAttest("notOurs"),
        onClick: () => void notOurs(),
      },
      can.canRedistribute && {
        key: "redistribute",
        label: tAction("redistribute"),
        onClick: () => void redistribute(),
      },
      can.canRequestChanges &&
        withTreasury && {
          key: "send_back",
          label: tBook("sendBack", { unit }),
          onClick: () => void sendBack(),
        },
      can.canWithdrawAttest && {
        key: "withdraw",
        label: tAction("withdraw_attest"),
        onClick: () => void explained("withdraw_attest"),
      },
      can.canMove && { key: "move", label: t("move"), onClick: onMove },
      can.canReturnToInbox && {
        key: "return",
        label: can.canMove ? tAction("return") : tAction("decline"),
        onClick: () => void back.run(can.canMove ? tAction("return") : tAction("decline")),
        danger: true,
      },
    ] as (Action | false)[]
  ).filter((a): a is Action => a !== false);

  const [primary, ...rest] = [
    ...actions.filter((a) => !a.danger),
    ...actions.filter((a) => a.danger),
  ];
  const busy = tr.busy || back.busy || sender.busy;
  if (!primary) return null;

  // Only the next step leads; quiet actions stay in the menu even alone.
  const quiet = (a: Action) =>
    ["redistribute", "withdraw", "move", "send_back", "not_ours", "return"].includes(a.key);
  const lead = quiet(primary) ? null : primary;
  const menu = lead ? rest : [primary, ...rest];

  return (
    <div className="flex w-full items-center gap-2.5 sm:w-auto">
      {lead &&
        (lead.disabledReason ? (
          <Tooltip label={lead.disabledReason} align="start" className="flex-1 sm:flex-none">
            <Button disabled className="w-full">
              {lead.icon}
              {lead.label}
              <span className="sr-only">{`. ${lead.disabledReason}`}</span>
            </Button>
          </Tooltip>
        ) : lead.href ? (
          <ButtonLink href={lead.href} className="flex-1 sm:flex-none">
            {lead.icon}
            {lead.label}
          </ButtonLink>
        ) : (
          <Button loading={busy} onClick={lead.onClick} className="flex-1 sm:flex-none">
            {lead.icon}
            {lead.label}
          </Button>
        ))}
      {menu.length > 0 && (
        <Menu
          label={t("more")}
          variant="secondary"
          disabled={busy}
          compact
          icon={lead ? <IconDots className="size-4 sm:hidden" /> : undefined}
          className={cn("shrink-0", !lead && "ml-auto")}
        >
          {menu.map((a, i) => (
            <Fragment key={a.key}>
              {a.danger && i > 0 && <MenuSeparator />}
              <MenuItem
                disabled={busy || Boolean(a.disabledReason)}
                onClick={() => (a.href ? router.push(a.href) : a.onClick?.())}
                className={a.danger ? "text-danger" : undefined}
              >
                {a.icon}
                {a.label}
              </MenuItem>
            </Fragment>
          ))}
        </Menu>
      )}
    </div>
  );
}

function MoveSection({
  invoice,
  resultUnits,
  onDone,
}: {
  invoice: SupplierInvoiceView;
  resultUnits: { id: string; name: string }[];
  onDone: () => void;
}) {
  const t = useTranslations("invoices.record");
  const tr = useTransition(invoice.id);
  return (
    <section className="border-t border-border px-inset py-3">
      <div className="max-w-sm">
        <Combobox
          size="sm"
          options={resultUnits
            .filter((u) => u.id !== invoice.resultUnitId)
            .map((u) => ({ value: u.id, label: u.name }))}
          value=""
          onChange={async (v) => {
            if (v && (await tr.run({ action: "assign", resultUnitId: v }))) onDone();
          }}
          placeholder={t("moveTo")}
          searchPlaceholder={t("searchUnit")}
          aria-label={t("moveTo")}
        />
      </div>
    </section>
  );
}

function FactStrip({ invoice }: { invoice: SupplierInvoiceView }) {
  const t = useTranslations("invoices.field");
  const tRecord = useTranslations("invoices.record");
  return (
    <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3">
      <StripCell label={t("amount")} className="col-span-2 sm:col-span-1" truncate>
        {invoice.amount == null ? (
          <span className="text-muted">-</span>
        ) : (
          <span className="text-base font-semibold tabular-nums">{formatSEK(invoice.amount)}</span>
        )}
      </StripCell>
      <StripCell label={t("dueDate")} truncate>
        {invoice.dueDate ? (
          <DueLabel dueDate={invoice.dueDate} />
        ) : (
          <span className="text-muted">-</span>
        )}
      </StripCell>
      <StripCell label={tRecord("unit")} truncate>
        {invoice.resultUnitName ?? "-"}
      </StripCell>
    </div>
  );
}

function SplitSection({ invoice }: { invoice: SupplierInvoiceView }) {
  const t = useTranslations("invoices.record");
  const tK = useTranslations("invoices.kontering");
  const share = (a: Allocation) =>
    a.amount ?? (invoice.allocations.length === 1 ? invoice.amount : null);

  if (invoice.allocations.length === 0) {
    return (
      <InspectorSection title={t("split")}>
        <p className="text-sm text-muted">
          {t("notAllocated", { unit: invoice.resultUnitName ?? "-" })}
        </p>
      </InspectorSection>
    );
  }

  return (
    <AllocationTable
      caption={t("split")}
      lines={invoice.allocations.map((a) => ({
        ...a,
        amount: share(a),
        attest: a.approvedByName ? (
          <AttestedBy name={a.approvedByName} />
        ) : a.canAttest && invoice.status === "PENDING_APPROVAL" ? (
          <span className="font-medium text-purple">{tK("yoursToAttest")}</span>
        ) : (
          <span className="text-muted">{a.resultUnit ?? "-"}</span>
        ),
      }))}
    />
  );
}

function BookingSection({ invoice, can }: WorkspaceProps) {
  const t = useTranslations("invoices.record");
  const tField = useTranslations("invoices.field");
  const tBook = useTranslations("invoices.book");
  const { date } = useFormat();

  const rounding = invoice.rounding ?? 0;
  const lines: VoucherLine[] = [
    ...invoice.lines.map((l) => ({
      key: l.id,
      account: l.account,
      accountName: l.accountName ?? "",
      costCenter: l.costCenterCode,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
    })),
    ...(rounding
      ? [
          {
            key: "rounding",
            account: String(ROUNDING_ACCOUNT),
            accountName: tBook("rounding"),
            debit: Math.max(rounding, 0),
            credit: Math.max(-rounding, 0),
          },
        ]
      : []),
    {
      key: "payable",
      account: String(PAYABLE_ACCOUNT),
      accountName: tBook("payable"),
      debit: 0,
      credit: invoice.amount ?? 0,
    },
  ];

  const facts: [string, React.ReactNode][] = [
    [tField("supplierName"), invoice.supplierName ?? "-"],
    [tField("invoiceNumber"), invoice.invoiceNumber ?? "-"],
    [tField("invoiceDate"), invoice.invoiceDate ? date(invoice.invoiceDate) : "-"],
    [tField("ocr"), invoice.ocr ?? "-"],
    ...(invoice.bankgiro
      ? [[tField("bankgiro"), invoice.bankgiro] as [string, React.ReactNode]]
      : []),
    ...(invoice.plusgiro
      ? [[tField("plusgiro"), invoice.plusgiro] as [string, React.ReactNode]]
      : []),
  ];

  return (
    <InspectorSection
      title={t("booking")}
      aside={
        invoice.fortnoxGivenNumber && (
          <span
            title={t("fortnoxLine", {
              number: invoice.fortnoxGivenNumber,
              date: invoice.exportedAt ? date(invoice.exportedAt) : "-",
            })}
            className="font-medium tabular-nums"
          >
            {t("fortnoxNumber", { number: invoice.fortnoxGivenNumber })}
          </span>
        )
      }
      flush
      endsInTable
      action={
        can.canBook ? (
          <ButtonLink href={`/invoices/${invoice.id}/book`} variant="secondary" size="sm">
            {t("rebook")}
          </ButtonLink>
        ) : undefined
      }
    >
      <dl className="mb-3 grid grid-cols-2 gap-x-6 gap-y-2 px-inset text-sm sm:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className={LABEL}>{label}</dt>
            <dd className="mt-0.5 truncate tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <VoucherTable lines={lines} />
    </InspectorSection>
  );
}
