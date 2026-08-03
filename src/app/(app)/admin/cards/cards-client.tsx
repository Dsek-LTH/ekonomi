"use client";

// Settings → Guild cards. Assigning a card to a member is what makes their
// card purchases show up under Card purchases.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyNote } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { Tag } from "@/components/ui/status-pill";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { useConfirm } from "@/components/confirm-dialog";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import type { Card as SectionCard, User } from "@/lib/domain/types";
import { Combobox } from "@/components/ui/combobox";

export function CardsClient({
  cards,
  users,
}: {
  cards: SectionCard[];
  users: User[];
}) {
  const t = useTranslations("admin.cards");
  const notify = useNotify();
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();
  const [newLast4, setNewLast4] = useState("");

  async function addCard() {
    const last4 = newLast4.trim();
    if (!/^\d{4}$/.test(last4)) {
      notify.error(t("last4Required"));
      return;
    }
    const data = await mutate("/api/cards", {
      key: "new-card",
      body: { last4 },
      error: t("createFailed"),
      success: t("created", { last4 }),
    });
    if (!data) return;
    setNewLast4("");
  }

  async function deleteCard(card: SectionCard) {
    const ok = await confirm({
      title: t("deleteTitle", { last4: card.last4 }),
      message:
        card.txCount > 0
          ? t("deleteMessageLinked", { count: card.txCount })
          : t("deleteMessage"),
      confirmLabel: t("delete"),
      tone: "danger",
    });
    if (!ok) return;
    await mutate(`/api/cards/${card.id}`, {
      key: card.id,
      method: "DELETE",
      error: t("deleteFailed"),
      success: t("deleted", { last4: card.last4 }),
    });
  }

  return (
    <Card>
      <CardHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <div className="flex items-center gap-2">
            <div className="w-28">
              <Input
                size="sm"
                value={newLast4}
                onChange={(e) => setNewLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pending !== "new-card") addCard();
                }}
                inputMode="numeric"
                placeholder={t("last4")}
                aria-label={t("last4Aria")}
                className="tabular-nums"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={pending === "new-card"}
              disabled={newLast4.length !== 4}
              onClick={addCard}
            >
              <IconPlus className="size-4" />
              {t("add")}
            </Button>
          </div>
        }
      />
      {cards.length === 0 ? (
        <EmptyNote>{t("empty")}</EmptyNote>
      ) : (
        <ul>
          {cards.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-inset py-3.5 last:border-0"
            >
              <Tag className="font-semibold tabular-nums">···· {c.last4}</Tag>
              <div className="hidden min-w-0 flex-1 sm:block" />
              <Combobox
                className="min-w-0 flex-1 sm:flex-none"
                options={users.map((u) => ({ value: u.id, label: u.name }))}
                value={c.holderId ?? ""}
                onChange={(e) =>
                  mutate(`/api/cards/${c.id}`, {
                    key: c.id,
                    method: "PATCH",
                    body: { holderId: e },
                  })
                }
              />
              <IconButton
                tone="danger"
                onClick={() => deleteCard(c)}
                loading={pending === c.id}
                label={t("deleteAria", { last4: c.last4 })}
              >
                <IconTrash className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
