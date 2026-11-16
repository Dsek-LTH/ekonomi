"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useMutation } from "@/components/shell/use-mutation";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { DateInput, Field } from "@/components/ui/field";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import type { ClosedTabDto } from "@/lib/data/board";

import { CustomerPicker, guessCustomer, useFortnoxCustomers } from "./customer-picker";

export interface ResendOptions {
  accountOptions: ComboOption[];
  costCenterOptions: ComboOption[];
}

/**
 * Sending an invoice that did not reach Fortnox again. What it was made with is filled in, and anything Fortnox
 * may have refused (the customer, the account, the cost centre, a date in a locked period) can be changed first.
 * A refusal is shown here, so the next try can fix it without closing.
 */
export function ResendDialog({
  invoice,
  options,
  onClose,
}: {
  invoice: ClosedTabDto;
  options: ResendOptions;
  onClose: () => void;
}) {
  const t = useTranslations("board.resend");
  const tTab = useTranslations("board.tab");
  const { pending, mutate } = useMutation();
  const [account, setAccount] = useState(invoice.account);
  const [costCenterId, setCostCenterId] = useState(invoice.costCenterId ?? "");
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoiceDate);
  const [error, setError] = useState<string | null>(null);
  const customers = useFortnoxCustomers();
  const [pickedCustomer, setPickedCustomer] = useState<string | null>(null);
  const customerNumber =
    pickedCustomer ??
    guessCustomer(customers.list, { customerNumber: invoice.customerNumber, ...invoice.member });

  async function send() {
    setError(null);
    const done = await mutate(`/api/board/invoices/${invoice.id}/send`, {
      body: { customerNumber, account, costCenterId: costCenterId || null, invoiceDate },
      error: tTab("resendFailed"),
      success: tTab("resent"),
      onError: setError,
    });
    if (done) onClose();
  }

  return (
    <Modal label={t("title")} onClose={onClose} className="max-w-md">
      <ModalHeader title={t("title")} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-inset py-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label={t("customer")}>
          <CustomerPicker
            customers={customers}
            value={customerNumber}
            onChange={setPickedCustomer}
            memberName={invoice.member.name}
          />
        </Field>
        <Field label={t("account")}>
          <Combobox
            options={options.accountOptions}
            value={account}
            onChange={setAccount}
            placeholder={t("accountPlaceholder")}
            aria-label={t("account")}
            searchable
          />
        </Field>
        <Field label={t("costCenter")}>
          <Combobox
            options={options.costCenterOptions}
            value={costCenterId}
            onChange={setCostCenterId}
            placeholder={t("noCostCenter")}
            aria-label={t("costCenter")}
            allowClear
          />
        </Field>
        <Field label={t("invoiceDate")}>
          <DateInput value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </Field>
      </div>
      <ModalFooter>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            onClick={send}
            disabled={!customerNumber || !account || !invoiceDate}
            loading={pending !== null}
          >
            {tTab("resend")}
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}
