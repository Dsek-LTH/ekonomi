"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Notice } from "@/components/ui/notice";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { Tag } from "@/components/ui/status-pill";
import { useMutation } from "@/components/shell/use-mutation";
import { useQuery } from "@/components/shell/use-query";
import { ALL_KINDS } from "@/lib/domain/notifications";
import type { NotificationKind } from "@/lib/domain/types";
import type { EmailFilter, EmailLogPage, EmailLogRow, EmailStatus } from "@/lib/data/emails";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";

// Mirrors EMAIL_LOG_PAGE in lib/data/emails.ts, which is server-only.
const PAGE = 50;

export const STATUS_TONE: Record<EmailStatus, "success" | "neutral" | "warning" | "danger"> = {
  SENT: "success",
  QUEUED: "neutral",
  RETRYING: "warning",
  FAILED: "danger",
};

export function EmailLog({ recipient }: { recipient?: { id: string; name: string } }) {
  const t = useTranslations("admin.email");
  const [filter, setFilter] = useState<EmailFilter>("");
  const [q, setQ] = useState("");
  const [take, setTake] = useState(PAGE);

  const params = new URLSearchParams();
  if (recipient) params.set("recipient", recipient.id);
  if (filter) params.set("filter", filter);
  if (q.trim()) params.set("q", q.trim());
  params.set("take", String(take));
  const { data, error, loading, reload } = useQuery<EmailLogPage>(`/api/emails?${params}`, {
    debounceMs: q ? 250 : 0,
  });

  const narrow =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setTake(PAGE);
    };

  return (
    <div className="space-y-3">
      {recipient && <TestEmailForm recipient={recipient} onSent={reload} />}

      {data && !data.mailEnabled && <Notice tone="info">{t("mailOff")}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs<EmailFilter>
          aria-label={t("filterLabel")}
          value={filter}
          onChange={narrow(setFilter)}
          options={[
            { value: "", label: t("filter.all") },
            { value: "sent", label: t("filter.sent") },
            { value: "unsent", label: t("filter.unsent") },
            { value: "failed", label: t("filter.failed") },
          ]}
        />
        {!recipient && (
          <SearchInput
            value={q}
            onChange={(e) => narrow(setQ)(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full sm:w-72"
          />
        )}
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {!data && !error && (
        <p className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner size="sm" />
          {t("loading")}
        </p>
      )}

      {data && data.rows.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">
          {filter || q ? t("noMatch") : recipient ? t("emptyPerson") : t("empty")}
        </p>
      )}

      {data && data.rows.length > 0 && (
        <ul
          className={cn(
            "divide-y divide-border rounded-panel border border-border",
            loading && "opacity-70",
          )}
        >
          {data.rows.map((row) => (
            <li key={row.id}>
              <LogRow row={row} showRecipient={!recipient} />
            </li>
          ))}
        </ul>
      )}

      {data?.more && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            loading={loading}
            onClick={() => setTake(take + PAGE)}
          >
            {t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

function LogRow({ row, showRecipient }: { row: EmailLogRow; showRecipient: boolean }) {
  const t = useTranslations("admin.email");
  const tKind = useTranslations("profile.notifications.kind");
  const { dateTime } = useFormat();

  return (
    <Link
      href={`/admin/email/${row.id}`}
      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{row.subject}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {[showRecipient ? row.recipient.name : null, tKind(row.kind), dateTime(row.createdAt)]
            .filter(Boolean)
            .join(" - ")}
        </span>
        {row.lastError && row.status !== "SENT" && (
          <span className="mt-1 block truncate font-mono text-xs text-danger">{row.lastError}</span>
        )}
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {row.sentBy && (
          <Tag size="sm" tone="purple" title={t("sentBy", { name: row.sentBy })}>
            {t("test")}
          </Tag>
        )}
        <Tag size="sm" tone={STATUS_TONE[row.status]}>
          {t(`status.${row.status}`)}
        </Tag>
      </span>
    </Link>
  );
}

function TestEmailForm({
  recipient,
  onSent,
}: {
  recipient: { id: string; name: string };
  onSent: () => void;
}) {
  const t = useTranslations("admin.email");
  const tKind = useTranslations("profile.notifications.kind");
  const { pending, mutate } = useMutation();
  const [kind, setKind] = useState<NotificationKind>("EXPENSE_SUBMITTED");

  const send = async () => {
    const ok = await mutate(`/api/users/${recipient.id}/test-email`, {
      key: "test",
      body: { kind },
      success: t("testSent", { name: recipient.name }),
      error: t("testFailed"),
      refresh: false,
    });
    if (ok) {
      onSent();
      setTimeout(onSent, 3000);
    }
  };

  return (
    <div className="space-y-2 rounded-panel border border-border p-4">
      <div>
        <h3 className="text-sm font-semibold">{t("testTitle")}</h3>
        <p className="mt-0.5 text-xs text-muted">{t("testHint")}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Combobox
          value={kind}
          onChange={(v) => setKind(v as NotificationKind)}
          options={ALL_KINDS.map((k) => ({ value: k, label: tKind(k) }))}
          className="min-w-0 flex-1"
        />
        <Button loading={pending === "test"} onClick={send}>
          {t("testSend")}
        </Button>
      </div>
    </div>
  );
}
