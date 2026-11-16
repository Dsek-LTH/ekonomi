"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { useFormat } from "@/lib/ui/use-format";
import type { InboxHealth } from "@/lib/data/supplier-invoices";

const CONNECT_REASONS = [
  "denied",
  "invalidState",
  "forbidden",
  "unconfigured",
  "wrongMailbox",
  "watchFailed",
];

/** The banner after Google sends the person back from connecting the mailbox (api/gmail/callback). */
function useMailboxConnectResult() {
  const t = useTranslations("admin.email.mailbox.result");
  const notify = useNotify();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const result = searchParams.get("gmail");
  const reason = searchParams.get("reason");
  // replaceState does not feed back into useSearchParams, so remember what was announced (as in
  // components/shell/fortnox-auth-result.tsx).
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (!result) return;
    const outcome = `${result}:${reason ?? ""}`;
    if (announced.current === outcome) return;
    announced.current = outcome;
    if (result === "connected") notify.success(t("connected"));
    else notify.error(t(reason && CONNECT_REASONS.includes(reason) ? reason : "failed"));
    window.history.replaceState(null, "", pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
}

/** The mailbox the levfaktura Inkorg reads: connect, reconnect or disconnect the one-time Google login. */
export function MailboxCard({ health }: { health: InboxHealth }) {
  const t = useTranslations("admin.email.mailbox");
  const { dateTime } = useFormat();
  const confirm = useConfirm();
  const disconnector = useMutation();
  useMailboxConnectResult();

  const disconnect = async () => {
    const ok = await confirm({
      title: t("disconnect"),
      message: t("disconnectConfirm", { address: health.address ?? "" }),
      confirmLabel: t("disconnect"),
      tone: "danger",
    });
    if (!ok) return;
    await disconnector.mutate("/api/gmail/connection", {
      method: "DELETE",
      success: t("disconnected"),
    });
  };

  return (
    <Card>
      <CardHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          health.enabled && (
            <div className="flex gap-2">
              {health.connected && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={disconnector.busy}
                  onClick={disconnect}
                >
                  {t("disconnect")}
                </Button>
              )}
              <ButtonLink
                href="/api/gmail/connect"
                size="sm"
                variant={health.connected ? "secondary" : "primary"}
              >
                {health.connected ? t("reconnect") : t("connect")}
              </ButtonLink>
            </div>
          )
        }
      />
      <CardBody className="space-y-1 text-sm">
        {!health.enabled ? (
          <p className="text-muted">{t("unconfigured")}</p>
        ) : health.connected ? (
          <>
            <p>
              {health.connectedBy && health.connectedAt
                ? t("connectedBy", {
                    address: health.address ?? "",
                    name: health.connectedBy,
                    when: dateTime(health.connectedAt),
                  })
                : t("connected", { address: health.address ?? "" })}
            </p>
            <p className="text-xs text-muted">
              {health.lastSyncAt
                ? t("lastSync", { when: dateTime(health.lastSyncAt) })
                : t("neverSynced")}
            </p>
          </>
        ) : (
          <p className="text-warning">{t("notConnected", { address: health.address ?? "" })}</p>
        )}
        {health.lastError && (
          <p className="text-danger">{t("error", { error: health.lastError })}</p>
        )}
      </CardBody>
    </Card>
  );
}
