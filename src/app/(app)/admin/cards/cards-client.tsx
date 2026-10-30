"use client";

// Settings → Guild cards. Assigning a card to a member is what makes their
// card purchases show up on their own bank feed, and assigning it a result unit
// is what lets that unit's resultatansvarig read them.
//
// The same shape as every other list in settings: one table, its create
// button on the toolbar, and the form that button opens just under it. It was
// a list with the "new card" field parked in an empty header and a gap between
// each card and its holder, with nothing saying what the dropdown was.
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClientDataTable, type ClientTabFilter } from "@/components/ui/client-data-table";
import { Combobox } from "@/components/ui/combobox";
import { type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { Tag } from "@/components/ui/status-pill";
import { useConfirm } from "@/components/confirm-dialog";
import { useNotify } from "@/components/shell/notifications";
import { useMutation } from "@/components/shell/use-mutation";
import { useTableControls } from "@/lib/data/use-list-query";
import type { Card as SectionCard, User } from "@/lib/domain/types";

export function CardsClient({
  cards,
  users,
  resultUnits,
}: {
  cards: SectionCard[];
  users: User[];
  resultUnits: { id: string; name: string }[];
}) {
  const t = useTranslations("admin.cards");
  const tCommon = useTranslations("common");
  const notify = useNotify();
  const confirm = useConfirm();
  const { pending, mutate } = useMutation();
  const controls = useTableControls({ sortKey: "card" });
  const [adding, setAdding] = useState(false);
  const [newLast4, setNewLast4] = useState("");

  const userOptions = users.map((u) => ({ value: u.id, label: u.name }));
  const unitOptions = resultUnits.map((u) => ({ value: u.id, label: u.name }));

  // A card on nobody is a card whose purchases reach nobody's own list, so it
  // is the one worth a tab of its own.
  const tabs: ClientTabFilter<SectionCard> = [
    { value: "all", label: t("tab.all") },
    { value: "noHolder", label: t("tab.noHolder"), predicate: (c) => !c.holderId },
  ];

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
    setAdding(false);
  }

  async function assign(card: SectionCard, holderId: string) {
    const holder = users.find((u) => u.id === holderId);
    await mutate(`/api/cards/${card.id}`, {
      key: `holder-${card.id}`,
      method: "PATCH",
      // "" clears it. See PatchCard.
      body: { holderId },
      error: t("assignFailed"),
      success: holder
        ? t("assigned", { last4: card.last4, name: holder.name })
        : t("unassigned", { last4: card.last4 }),
    });
  }

  async function assignUnit(card: SectionCard, resultUnitId: string) {
    const unit = resultUnits.find((u) => u.id === resultUnitId);
    await mutate(`/api/cards/${card.id}`, {
      key: `unit-${card.id}`,
      method: "PATCH",
      // "" clears it. See PatchCard.
      body: { resultUnitId },
      error: t("unitAssignFailed"),
      success: unit
        ? t("unitAssigned", { last4: card.last4, name: unit.name })
        : t("unitUnassigned", { last4: card.last4 }),
    });
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

  const columns: Column<SectionCard>[] = [
    {
      key: "card",
      header: t("colCard"),
      value: (c) => c.last4,
      sortable: true,
      searchable: true,
      mobile: "title",
      className: "w-32",
      cell: (c) => <Tag className="font-semibold tabular-nums">····{c.last4}</Tag>,
    },
    {
      key: "holder",
      mobile: "meta",
      mobileCell: (c) => c.holderName ?? t("noHolder"),
      header: t("colHolder"),
      value: (c) => c.holderName ?? "",
      sortable: true,
      searchable: true,
      cell: (c) => (
        <Combobox
          size="sm"
          className="w-full sm:w-64"
          options={userOptions}
          value={c.holderId ?? ""}
          onChange={(v) => assign(c, v)}
          disabled={pending === `holder-${c.id}`}
          placeholder={t("noHolder")}
          allowClear
          aria-label={t("holderFor", { last4: c.last4 })}
        />
      ),
    },
    {
      key: "resultUnit",
      mobile: "meta",
      mobileCell: (c) => c.resultUnitName ?? t("noResultUnit"),
      header: t("colResultUnit"),
      value: (c) => c.resultUnitName ?? "",
      sortable: true,
      searchable: true,
      cell: (c) => (
        <Combobox
          size="sm"
          className="w-full sm:w-56"
          options={unitOptions}
          value={c.resultUnitId ?? ""}
          onChange={(v) => assignUnit(c, v)}
          disabled={pending === `unit-${c.id}`}
          placeholder={t("noResultUnit")}
          allowClear
          aria-label={t("resultUnitFor", { last4: c.last4 })}
        />
      ),
    },
    {
      key: "purchases",
      mobile: "hide",
      header: t("colPurchases"),
      value: (c) => c.txCount,
      sortable: true,
      align: "right",
      // To the purchases themselves, on the section's feed searched for the
      // card's number, which is what Bank's search reads.
      cell: (c) =>
        c.txCount > 0 ? (
          <Link
            href={`/bank?scope=all&q=${c.last4}`}
            className="tabular-nums text-accent underline decoration-faint underline-offset-2 hover:decoration-current"
          >
            {c.txCount}
          </Link>
        ) : (
          <span className="tabular-nums text-muted">0</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "actions",
      className: "w-14",
      cell: (c) => (
        <IconButton
          tone="danger"
          onClick={() => deleteCard(c)}
          loading={pending === c.id}
          label={t("deleteAria", { last4: c.last4 })}
        >
          <IconTrash className="size-4" />
        </IconButton>
      ),
    },
  ];

  return (
    <Card>
      <ClientDataTable
        columns={columns}
        rows={cards}
        controls={controls}
        tabs={tabs}
        searchPlaceholder={t("searchPlaceholder")}
        rowKey={(c) => c.id}
        empty={cards.length === 0 ? t("empty") : t("noMatch")}
        action={
          !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <IconPlus className="size-4" />
              {t("new")}
            </Button>
          )
        }
        actionPanel={
          adding && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-32">
                <Input
                  size="sm"
                  autoFocus
                  value={newLast4}
                  onChange={(e) => setNewLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && pending !== "new-card") addCard();
                    if (e.key === "Escape") setAdding(false);
                  }}
                  inputMode="numeric"
                  placeholder={t("last4")}
                  aria-label={t("last4Aria")}
                  className="tabular-nums"
                />
              </div>
              <Button
                size="sm"
                loading={pending === "new-card"}
                disabled={newLast4.length !== 4}
                onClick={addCard}
              >
                {t("add")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
                {tCommon("cancel")}
              </Button>
              <p className="w-full text-xs text-muted">{t("addHint")}</p>
            </div>
          )
        }
      />
    </Card>
  );
}
