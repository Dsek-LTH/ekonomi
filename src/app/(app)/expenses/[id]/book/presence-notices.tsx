"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { useRole } from "@/components/shell/role-context";
import { useProgressRouter } from "@/components/shell/route-progress";
import { useFormat } from "@/lib/ui/use-format";
import type { PresentUser } from "@/lib/domain/presence";

/** Colleagues who have this utlägg's booking screen open too. Nothing when none. */
export function OthersBookingNotice({ others }: { others: PresentUser[] }) {
  const t = useTranslations("book.presence");
  const { list } = useFormat();
  if (others.length === 0) return null;
  return (
    <Notice>{t("banner", { names: list(others.map((o) => o.name)), count: others.length })}</Notice>
  );
}

/**
 * The utlägg was saved by somebody else while this screen had it open.
 *
 * A dialog first, because whatever is typed here is now written against a
 * version that is gone and the bookkeeper has to know before they do any more
 * of it. Then, once dismissed, a notice that stays: closing the dialog is "let
 * me copy what I wrote", not "carry on", and the save button stays dead until
 * the page is reloaded (the server would refuse it anyway).
 *
 * Reloading is a refresh of the Server Components. The page keys this screen on
 * the utlägg's version, so the refresh remounts it with the new voucher rather
 * than keeping the rows typed into the old one.
 */
export function UpdatedElsewhere({ by }: { by?: PresentUser }) {
  const t = useTranslations("book.presence");
  const { user } = useRole();
  const router = useProgressRouter();
  const [open, setOpen] = useState(true);

  const message = !by
    ? t("updatedMessageUnknown")
    : by.id === user.id
      ? t("updatedMessageSelf")
      : t("updatedMessage", { name: by.name });
  const reload = () => router.refresh();

  return (
    <>
      <Notice tone="danger">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {t("staleBanner")}
          <Button size="sm" variant="secondary" onClick={reload}>
            {t("reload")}
          </Button>
        </span>
      </Notice>
      {open && (
        <Modal label={t("updatedTitle")} onClose={() => setOpen(false)} className="sm:max-w-md">
          <ModalHeader title={t("updatedTitle")} />
          <ModalBody>
            <p className="text-sm text-muted">{message}</p>
          </ModalBody>
          <ModalFooter>
            <span />
            <div className="flex gap-2.5">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                {t("close")}
              </Button>
              <Button autoFocus size="sm" onClick={reload}>
                {t("reload")}
              </Button>
            </div>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}
