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

export function OthersBookingNotice({ others }: { others: PresentUser[] }) {
  const t = useTranslations("book.presence");
  const { list } = useFormat();
  if (others.length === 0) return null;
  return (
    <Notice>{t("banner", { names: list(others.map((o) => o.name)), count: others.length })}</Notice>
  );
}

/** Saved by somebody else while this screen was open. The save button stays dead until reload,
 * since the server would refuse it. */
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
