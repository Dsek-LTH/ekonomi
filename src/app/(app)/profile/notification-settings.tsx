"use client";

// Which emails this member gets. One box per kind, saved as it is ticked: a
// form with its own Save button would leave a box that looks switched off and
// is not, for as long as nobody presses it.
//
// The defaults come first and the opt-ins after, in the order
// lib/domain/notifications.ts lists them. The weekly digest is not here because
// it cannot be switched off; the note under the list says so instead.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@/components/shell/use-mutation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { NotificationKind } from "@/lib/domain/types";

export function NotificationSettings({
  email,
  initial,
}: {
  email: string;
  initial: { kind: NotificationKind; enabled: boolean }[];
}) {
  const t = useTranslations("profile.notifications");
  const { mutate } = useMutation();
  const [on, setOn] = useState(() => new Map(initial.map((n) => [n.kind, n.enabled])));

  const toggle = async (kind: NotificationKind) => {
    const enabled = !on.get(kind);
    setOn((prev) => new Map(prev).set(kind, enabled));
    const ok = await mutate("/api/profile/notifications", {
      key: kind,
      method: "PUT",
      body: { kind, enabled },
      error: t("saveFailed"),
      refresh: false,
    });
    // Put the box back the way the server still has it.
    if (ok === null) setOn((prev) => new Map(prev).set(kind, !enabled));
  };

  return (
    <Card>
      <CardHeader title={t("title")} subtitle={t("subtitle", { email })} />
      <CardBody className="space-y-3">
        {initial.map(({ kind }) => (
          <Checkbox
            key={kind}
            checked={!!on.get(kind)}
            onChange={() => toggle(kind)}
            label={t(`kind.${kind}`)}
            className="flex w-full items-start gap-3"
          >
            <span className="text-sm">
              {t(`kind.${kind}`)}
              <span className="block text-xs text-muted">{t(`hint.${kind}`)}</span>
            </span>
          </Checkbox>
        ))}
        <p className="border-t border-border pt-3 text-xs text-muted">{t("digestNote")}</p>
      </CardBody>
    </Card>
  );
}
