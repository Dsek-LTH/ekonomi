"use client";

// One levfaktura's record (/invoices/[id]), laid out as an utlägg's is
// (expenses/[id]): one card read top to bottom, the same in every state. The
// status and the actions, the facts in ruled columns, what the forwarder
// wrote, the fördelning and who signed it, the kontering once there is one,
// and the history. What changes as the invoice moves on is the main button
// and which sections have something in them, never the shape of the page.
//
// The work is done elsewhere and comes back here, as an utlägg's editing and
// kontering do: the unit fördelar on ./allocate, the treasury konterar on
// ./book. Two acts happen on the record itself because they are one press
// each: another unit signing its share, and sending the konterade invoice to
// Fortnox. The quiet actions (Byt enhet, Ändra fördelningen, Ångra attest,
// Begär ändring, Tillbaka till inkorgen) are under "Mer", and Ändra kontering
// is on the kontering itself, as an utlägg's Ändra is on its verifikation.
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
import { InspectorSection } from "../../expenses/[id]/detail-sections";
import { UncertainExport } from "../book-view";
import { DueLabel, InvoiceStatusPill, useInvoiceTitle } from "../invoice-bits";
import {
  LABEL,
  ReturnedNotice,
  Timeline,
  invoiceDocuments,
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
  /** Only for a reader who may send it to Fortnox, so the button can say why
   *  it cannot yet. Null for everyone else. */
  fortnox: FortnoxStatus | null;
}) {
  const { invoice } = data;
  const title = useInvoiceTitle();
  const booked = invoice.status === "BOOKED" || invoice.status === "EXPORTED";
  // The reference, unless it is the title already, then who sent it in, and
  // the supplier once the treasury has settled it.
  const subtitle = [
    invoice.description && invoice.reference,
    booked ? invoice.supplierName : (invoice.mail?.fromName ?? invoice.receivedByName),
  ]
    .filter(Boolean)
    .join(" - ");
  return (
    <PageShell width="content" title={title(invoice)} subtitle={subtitle || undefined} back={backHref}>
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

function InvoiceRecord(props: WorkspaceProps & { backHref: string; fortnox: FortnoxStatus | null }) {
  const { invoice, can, backHref, fortnox } = props;
  const tDetail = useTranslations("invoices.detail");
  const router = useProgressRouter();
  const docs = useMutation();
  const [moving, setMoving] = useState(false);
  const uncertain = invoice.exportState === "UNCERTAIN" && can.canBook;

  async function uploadDocument(file: File) {
    const form = new FormData();
    form.append("file", file);
    await docs.mutate(`/api/supplier-invoices/${invoice.id}/documents`, { body: form, key: "upload" });
  }

  return (
    <>
      <ReceiptPanelSource
        documents={invoiceDocuments(invoice)}
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
            // Sent back to the Inkorg, it is not an invoice any more, so
            // there is no record left to look at.
            onGone={() => router.push(backHref)}
          />
        </div>
        {moving && <MoveSection invoice={invoice} resultUnits={props.resultUnits} onDone={() => setMoving(false)} />}

        <FactStrip invoice={invoice} />

        {invoice.mail?.note && (
          <InspectorSection title={tDetail("note")}>
            <p className="whitespace-pre-line text-sm">
              <span className="font-medium">{invoice.mail.fromName ?? invoice.mail.fromAddress}:</span>{" "}
              {invoice.mail.note}
            </p>
          </InspectorSection>
        )}

        <SplitSection invoice={invoice} />

        {(invoice.status === "BOOKED" || invoice.status === "EXPORTED") && <BookingSection {...props} />}

        <Timeline invoice={invoice} />
      </Card>
    </>
  );
}

/** Who it waits on, beside the status, when that is somebody else. */
function WaitingOn({ invoice }: { invoice: SupplierInvoiceView }) {
  const t = useTranslations("invoices.record");
  if (invoice.status !== "PENDING_APPROVAL" && invoice.status !== "ASSIGNED" && invoice.status !== "CHANGES_REQUESTED") {
    return null;
  }
  const units =
    invoice.status === "PENDING_APPROVAL"
      ? [...new Set(invoice.allocations.filter((a) => !a.approvedByName).map((a) => a.resultUnit ?? a.costCenterCode))]
      : [invoice.resultUnitName ?? "-"];
  return <span className="text-sm text-muted">{t("waitingFor", { units: units.join(", ") })}</span>;
}

/**
 * What is worth a look before it goes to Fortnox, the way an utlägg's
 * bokföring warns. None of it stops the sending, except a Fortnox connection
 * the section does not have.
 */
function SendNotice({ invoice, fortnox }: { invoice: SupplierInvoiceView; fortnox: FortnoxStatus | null }) {
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
  /** A link (fördela, kontera) rather than a button. */
  href?: string;
  onClick?: () => void;
  /** Why it cannot be done now, on hover. A dead button with no reason on it
   *  reads as a fault. */
  disabledReason?: string;
  danger?: boolean;
};

/**
 * The invoice's actions, as an utlägg's (ExpenseActions): the one the status
 * is waiting for as the button, the rest behind "Mer".
 */
function RecordActions({
  invoice,
  can,
  fortnox,
  sendBlocked,
  onMove,
  onGone,
}: WorkspaceProps & {
  fortnox: FortnoxStatus | null;
  /** An earlier sending whose outcome is not known yet. */
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
  const back = useReturnToInbox(invoice.id, (status) => (status === "RETURNED" ? onGone() : undefined));
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

  // Another unit saying its share is not theirs: back to the unit that
  // proposed the split, with every signature taken off.
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
    // Reopened, the split is the unit's to make again, on its page.
    if (ok && (await tr.run({ action: "redistribute" }))) router.push(`/invoices/${invoice.id}/allocate`);
  }

  // Sending to Fortnox, asked first: a supplier invoice made there cannot be
  // taken back from here. A bankgiro the register does not know is said in
  // the question, which is then the confirmation the export needs for it.
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
      can.canAttest && { key: "not_ours", label: tAttest("notOurs"), onClick: () => void notOurs() },
      can.canRedistribute && { key: "redistribute", label: tAction("redistribute"), onClick: () => void redistribute() },
      can.canRequestChanges &&
        withTreasury && { key: "send_back", label: tBook("sendBack", { unit }), onClick: () => void sendBack() },
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

  // Sending it back is never what the page is waiting for, so it never leads.
  const [primary, ...rest] = [...actions.filter((a) => !a.danger), ...actions.filter((a) => a.danger)];
  const busy = tr.busy || back.busy || sender.busy;
  if (!primary) return null;

  // The main action leads only when it is the invoice's next step. One that
  // is only ever quiet (moving it, sending it back) stays in the menu even
  // alone, so the header never offers it as the thing to do.
  const quiet = (a: Action) => ["redistribute", "withdraw", "move", "send_back", "not_ours", "return"].includes(a.key);
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

/** Giving it to another unit, opened from the menu. */
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
          options={resultUnits.filter((u) => u.id !== invoice.resultUnitId).map((u) => ({ value: u.id, label: u.name }))}
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

/** One cell of the fact strip, as on an utlägg's: a label in small capitals,
 *  the value under it. */
function StripCell({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-0 bg-background px-inset py-3", className)}>
      <p className={LABEL}>{label}</p>
      <div className="mt-1 min-w-0 truncate text-sm">{children}</div>
    </div>
  );
}

/**
 * The three facts every reader comes for, in ruled columns under the status,
 * the same three in every state: how much, by when, and whose. The first two
 * are the unit's to say when it fördelar the invoice, and are a dash until
 * then.
 */
function FactStrip({ invoice }: { invoice: SupplierInvoiceView }) {
  const t = useTranslations("invoices.field");
  const tRecord = useTranslations("invoices.record");
  return (
    <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3">
      <StripCell label={t("amount")} className="col-span-2 sm:col-span-1">
        {invoice.amount == null ? (
          <span className="text-muted">-</span>
        ) : (
          <span className="text-base font-semibold tabular-nums">{formatSEK(invoice.amount)}</span>
        )}
      </StripCell>
      <StripCell label={t("dueDate")}>
        {invoice.dueDate ? <DueLabel dueDate={invoice.dueDate} /> : <span className="text-muted">-</span>}
      </StripCell>
      <StripCell label={tRecord("unit")}>{invoice.resultUnitName ?? "-"}</StripCell>
    </div>
  );
}

/** The fördelning, as an utlägg's (AllocationSection): a row per cost centre,
 *  its share, and who attested it or whose it is still to attest. */
function SplitSection({ invoice }: { invoice: SupplierInvoiceView }) {
  const t = useTranslations("invoices.record");
  const tK = useTranslations("invoices.kontering");
  const share = (a: Allocation) => a.amount ?? (invoice.allocations.length === 1 ? invoice.amount : null);
  const total = invoice.allocations.reduce((s, a) => s + (share(a) ?? 0), 0);

  if (invoice.allocations.length === 0) {
    return (
      <InspectorSection title={t("split")}>
        <p className="text-sm text-muted">{t("notAllocated", { unit: invoice.resultUnitName ?? "-" })}</p>
      </InspectorSection>
    );
  }

  const attest = (a: Allocation) =>
    a.approvedByName ? (
      <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-success">
        <IconCheck className="size-3.5 shrink-0" />
        <span className="truncate">{a.approvedByName}</span>
      </span>
    ) : a.canAttest && invoice.status === "PENDING_APPROVAL" ? (
      <span className="font-medium text-purple">{tK("yoursToAttest")}</span>
    ) : (
      <span className="text-muted">{a.resultUnit ?? "-"}</span>
    );

  return (
    <section className="border-t border-border px-inset pb-2 pt-4">
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">{t("split")}</caption>
        <thead>
          <tr className="text-left">
            <th className={cn(LABEL, "pb-2 pr-3")}>{t("costCenter")}</th>
            <th className={cn(LABEL, "w-32 pb-2 text-right")}>{t("amount")}</th>
            <th className={cn(LABEL, "hidden w-[38%] pb-2 pl-6 sm:table-cell")}>{t("attestColumn")}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.allocations.map((a) => (
            <tr key={a.id} className="border-t border-border align-top">
              <td className="py-2 pr-3">
                <div className="truncate">
                  <span className="font-medium tabular-nums">{a.costCenterCode}</span>
                  <span className="ml-2 text-muted">{a.costCenterName}</span>
                </div>
                <div className="mt-0.5 truncate text-xs sm:hidden">{attest(a)}</div>
                {a.comment && <p className="mt-1 text-xs italic text-muted">{a.comment}</p>}
              </td>
              <td className="whitespace-nowrap py-2 text-right tabular-nums">
                {share(a) == null ? <span className="text-muted">-</span> : formatSEK(share(a)!)}
              </td>
              <td className="hidden truncate py-2 pl-6 text-xs leading-5 sm:table-cell">{attest(a)}</td>
            </tr>
          ))}
        </tbody>
        {invoice.allocations.length > 1 && (
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td className="py-2 pr-3">{t("total")}</td>
              <td className="whitespace-nowrap py-2 text-right tabular-nums">{formatSEK(total)}</td>
              <td className="hidden sm:table-cell" />
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  );
}

/**
 * The kontering, once there is one, as an utlägg's verifikation: the supplier
 * invoice's head (who from, which number, when, how it is paid), then the
 * lines as a ledger prints them, ending on the leverantörsskuld. Fortnox's
 * number beside the title once it is there.
 */
function BookingSection({ invoice, can }: WorkspaceProps) {
  const t = useTranslations("invoices.record");
  const tField = useTranslations("invoices.field");
  const tBook = useTranslations("invoices.book");
  const { date } = useFormat();

  const toOre = (sek: number | null) => (sek == null ? 0 : Math.round(sek * 100));
  const rounding = toOre(invoice.rounding);
  const lines = [
    ...invoice.lines.map((l) => ({
      key: l.id,
      account: l.account,
      name: l.accountName ?? "",
      costCenter: l.costCenterCode ?? "",
      debit: toOre(l.debit),
      credit: toOre(l.credit),
    })),
    ...(rounding
      ? [{ key: "rounding", account: String(ROUNDING_ACCOUNT), name: tBook("rounding"), costCenter: "", debit: Math.max(rounding, 0), credit: Math.max(-rounding, 0) }]
      : []),
    { key: "payable", account: String(PAYABLE_ACCOUNT), name: tBook("payable"), costCenter: "", debit: 0, credit: toOre(invoice.amount) },
  ];
  const kr = (ore: number) => (ore ? formatSEK(ore / 100) : "");

  const facts: [string, React.ReactNode][] = [
    [tField("supplierName"), invoice.supplierName ?? "-"],
    [tField("invoiceNumber"), invoice.invoiceNumber ?? "-"],
    [tField("invoiceDate"), invoice.invoiceDate ? date(invoice.invoiceDate) : "-"],
    [tField("ocr"), invoice.ocr ?? "-"],
    ...(invoice.bankgiro ? [[tField("bankgiro"), invoice.bankgiro] as [string, React.ReactNode]] : []),
    ...(invoice.plusgiro ? [[tField("plusgiro"), invoice.plusgiro] as [string, React.ReactNode]] : []),
  ];

  return (
    <InspectorSection
      title={t("booking")}
      aside={
        invoice.fortnoxGivenNumber && (
          <span title={t("fortnoxLine", { number: invoice.fortnoxGivenNumber, date: invoice.exportedAt ? date(invoice.exportedAt) : "-" })} className="font-medium tabular-nums">
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
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="text-left">
            <th className={cn(LABEL, "w-16 pb-2 pl-inset")}>{t("account")}</th>
            <th className={cn(LABEL, "pb-2 pl-3")}>{t("accountName")}</th>
            <th className={cn(LABEL, "hidden w-20 pb-2 pl-3 sm:table-cell")}>{t("costCenterShort")}</th>
            <th className={cn(LABEL, "w-28 pb-2 pl-3 text-right")}>{t("debit")}</th>
            <th className={cn(LABEL, "w-28 pb-2 pl-3 pr-inset text-right")}>{t("credit")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} className="border-t border-border align-top">
              <td className="py-2 pl-inset font-medium tabular-nums">{l.account}</td>
              <td className="truncate py-2 pl-3">{l.name}</td>
              <td className="hidden py-2 pl-3 tabular-nums text-muted sm:table-cell">{l.costCenter}</td>
              <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">{kr(l.debit)}</td>
              <td className="whitespace-nowrap py-2 pl-3 pr-inset text-right tabular-nums">{kr(l.credit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </InspectorSection>
  );
}
