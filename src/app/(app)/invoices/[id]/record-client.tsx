"use client";

import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
import { Issues, type IssueItem } from "@/components/ui/notice";
import { Tooltip } from "@/components/ui/tooltip";
import { IconAlert, IconCheck, IconDots } from "@/components/ui/icons";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { useProgressRouter } from "@/components/shell/route-progress";
import { useGoUp } from "@/components/shell/route-history";
import { giroMismatch } from "@/lib/domain/payment-ref";
import { PAYABLE_ACCOUNT, ROUNDING_ACCOUNT } from "@/lib/domain/supplier-invoice";
import { formatSEK } from "@/lib/ui/format";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import type { FortnoxStatus } from "@/lib/domain/types";
import type { SupplierInvoiceView } from "@/lib/data/supplier-invoices";
import {
  AllocationTable,
  AttestedBy,
  InspectorSection,
  StripCell,
  VoucherSection,
  type VoucherFact,
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
  // The small line over the title, as on an utlägg: the reference and whose it is (the supplier once booked).
  const eyebrow = [
    invoice.description && invoice.reference,
    booked ? invoice.supplierName : (invoice.mail?.fromName ?? invoice.receivedByName),
  ]
    .filter(Boolean)
    .join(" - ");
  return (
    <InvoiceRecord
      {...data}
      title={title(invoice)}
      eyebrow={eyebrow || undefined}
      backHref={backHref}
      fortnox={fortnox}
    />
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

function InvoiceRecord({
  title,
  eyebrow,
  ...props
}: WorkspaceProps & {
  title: string;
  eyebrow?: string;
  backHref: string;
  fortnox: FortnoxStatus | null;
}) {
  const { invoice, can, backHref } = props;
  const tDetail = useTranslations("invoices.detail");
  // The invoice is gone: back out to the list rather than leaving its record in the history.
  const goUp = useGoUp();
  const docs = useMutation();
  const [moving, setMoving] = useState(false);
  const uncertain = invoice.exportState === "UNCERTAIN" && can.canBook;
  const documents = useInvoicePanelDocuments(invoice);
  const sendIssues = useSendIssues(invoice);

  async function uploadDocument(file: File) {
    const form = new FormData();
    form.append("file", file);
    await docs.mutate(`/api/supplier-invoices/${invoice.id}/documents`, {
      body: form,
      key: "upload",
    });
  }

  // The next step beside the title, as on an utlägg. What is worth a look before sending sits beside the button that sends.
  const actions = (
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
      {can.canSend && !uncertain && (
        <Issues items={sendIssues} className="sm:max-w-xs sm:text-right" />
      )}
      <RecordActions
        {...props}
        sendBlocked={uncertain}
        onMove={() => setMoving(!moving)}
        onGone={() => goUp(backHref)}
      />
    </div>
  );

  return (
    <PageShell width="content" title={title} eyebrow={eyebrow} aside={actions} back={backHref}>
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
      {uncertain && <UncertainExport invoice={invoice} />}

      <Card>
        {moving && (
          <MoveSection
            invoice={invoice}
            resultUnits={props.resultUnits}
            onDone={() => setMoving(false)}
          />
        )}

        <FactStrip invoice={invoice} />

        <SplitSection invoice={invoice} />

        {(invoice.status === "BOOKED" || invoice.status === "EXPORTED") && (
          <BookingSection {...props} />
        )}

        <Timeline invoice={invoice} />
      </Card>
    </PageShell>
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
  return (
    <span className="mt-1 block truncate text-xs text-muted">
      {t("waitingFor", { units: units.join(", ") })}
    </span>
  );
}

/** Warnings before sending to Fortnox. None blocks, except a missing Fortnox connection. */
/**
 * Worth a look before sending. Overdue is said on the due date itself and "Fortnox not connected" is the send button's
 * disabled reason, so only a bankgiro that differs from Fortnox's register is left: money to the wrong account.
 */
function useSendIssues(invoice: SupplierInvoiceView): IssueItem[] {
  const tWs = useTranslations("invoices.workspace");
  const tField = useTranslations("invoices.field");
  const mismatch = invoice.register ? giroMismatch(invoice, invoice.register) : null;
  if (!mismatch) return [];
  return [
    {
      key: "giro",
      tone: "danger",
      text: tWs("giroWarning", {
        field: tField(mismatch.field).toLowerCase(),
        invoice: mismatch.invoice,
        register: mismatch.register ?? tWs("giroNone"),
      }),
    },
  ];
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
  const notify = useNotify();
  const back = useReturnToInbox(invoice.id, (status) =>
    status === "RETURNED" ? onGone() : undefined,
  );
  const unit = invoice.resultUnitName ?? "-";
  const withTreasury = invoice.status === "APPROVED" || invoice.status === "BOOKED";
  const remover = useMutation();

  async function remove() {
    const ok = await confirm({
      title: t("deleteTitle"),
      message: t("deleteMessage"),
      confirmLabel: t("delete"),
      tone: "danger",
    });
    if (!ok) return;
    const res = await remover.mutate(`/api/supplier-invoices/${invoice.id}`, {
      method: "DELETE",
      error: t("deleteFailed"),
      success: t("deleted"),
      refresh: false,
    });
    if (res) onGone();
  }

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
    const res = await sender.mutate<{ givenNumber: string; linked?: boolean }>(
      `/api/supplier-invoices/${invoice.id}/export`,
      { body: { confirmGiro: Boolean(mismatch) } },
    );
    if (res)
      notify.success(res.linked ? tWs("linked", { number: res.givenNumber }) : tWs("exported"));
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
      can.canDelete &&
        !sendBlocked && {
          key: "delete",
          label: t("delete"),
          onClick: () => void remove(),
          danger: true,
        },
    ] as (Action | false)[]
  ).filter((a): a is Action => a !== false);

  const [primary, ...rest] = [
    ...actions.filter((a) => !a.danger),
    ...actions.filter((a) => a.danger),
  ];
  const busy = tr.busy || back.busy || sender.busy || remover.busy;
  if (!primary) return null;

  // Only the next step leads; quiet actions stay in the menu even alone.
  const quiet = (a: Action) =>
    ["redistribute", "withdraw", "move", "send_back", "not_ours", "return", "delete"].includes(
      a.key,
    );
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
    <section className="border-t border-border px-inset py-3 first:border-t-0">
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
    // Where it stands first, as on an utlägg. First in the card, it drops its top rule and takes the card's top corners.
    <div className="grid grid-cols-2 gap-px overflow-hidden border-t border-border bg-border first:rounded-t-panel first:border-t-0 sm:grid-cols-4">
      <StripCell label={tRecord("status")}>
        <InvoiceStatusPill status={invoice.status} />
        <WaitingOn invoice={invoice} />
      </StripCell>
      <StripCell label={t("amount")} truncate>
        {invoice.amount == null ? (
          <span className="text-muted">-</span>
        ) : (
          <span className="text-base font-semibold tabular-nums">{formatSEK(invoice.amount)}</span>
        )}
      </StripCell>
      <StripCell label={t("dueDate")} truncate>
        {invoice.dueDate ? (
          <DueLabel dueDate={invoice.dueDate} spelled />
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

  // Who did the last of each step, from the history.
  const last = (type: string) => invoice.events.findLast((e) => e.type === type);
  const booked = last("BOOKED");
  const sent = invoice.status === "EXPORTED" ? last("EXPORTED") : undefined;

  // A giro the Fortnox register has for this supplier gets a check; one it does not, a warning.
  const mismatch = invoice.register ? giroMismatch(invoice, invoice.register) : null;
  const giroNote = (field: "bankgiro" | "plusgiro") =>
    !invoice.register ? undefined : mismatch?.field === field ? (
      <span className="inline-flex items-center gap-1 font-medium text-warning">
        <IconAlert className="size-3.5" />
        {t("giroNotInRegister")}
      </span>
    ) : (
      <span title={t("giroInRegister")} className="inline-flex text-success">
        <IconCheck className="size-3.5" />
        <span className="sr-only">{t("giroInRegister")}</span>
      </span>
    );

  // Read across in pairs from sm: who and which invoice, when and how it is paid.
  const facts: VoucherFact[] = [
    { label: tField("supplierName"), value: invoice.supplierName ?? "-" },
    {
      label: tField("invoiceNumber"),
      value: invoice.invoiceNumber ?? "-",
      mono: Boolean(invoice.invoiceNumber),
    },
    { label: tField("invoiceDate"), value: invoice.invoiceDate ? date(invoice.invoiceDate) : "-" },
    { label: tField("ocr"), value: invoice.ocr ?? "-", mono: Boolean(invoice.ocr) },
    ...(invoice.bankgiro
      ? [
          {
            label: tField("bankgiro"),
            value: invoice.bankgiro,
            mono: true,
            note: giroNote("bankgiro"),
          },
        ]
      : []),
    ...(invoice.plusgiro
      ? [
          {
            label: tField("plusgiro"),
            value: invoice.plusgiro,
            mono: true,
            note: giroNote("plusgiro"),
          },
        ]
      : []),
    ...(invoice.yourReference
      ? [{ label: tField("yourReference"), value: invoice.yourReference }]
      : []),
  ];

  return (
    <VoucherSection
      title={t("booking")}
      number={invoice.fortnoxGivenNumber}
      numberHint={
        invoice.fortnoxGivenNumber
          ? t("fortnoxLine", {
              number: invoice.fortnoxGivenNumber,
              date: invoice.exportedAt ? date(invoice.exportedAt) : "-",
            })
          : undefined
      }
      sent={sent && { date: invoice.exportedAt ?? sent.date, by: sent.actor }}
      facts={facts}
      action={
        can.canBook ? (
          <ButtonLink href={`/invoices/${invoice.id}/book`} variant="secondary" size="sm">
            {t("rebook")}
          </ButtonLink>
        ) : undefined
      }
      lines={lines}
      people={[
        ...(booked ? [{ label: t("bookedBy"), name: booked.actor ?? "-", date: booked.date }] : []),
      ]}
    />
  );
}
