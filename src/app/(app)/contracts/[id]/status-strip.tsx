"use client";

// Where the contract stands, and who has put their name to it.
//
// The first thing on the page, because it is the first thing anybody opening a
// contract wants to know, and it used to be the last: whether it was signed sat
// at the bottom, inside the parties card, under the documents.
//
// Every contract platform puts these two facts together and at the top, and for
// the same reason. "Signerat" on its own is a claim; "signerat, by these two
// people, on these days" is the fact behind it, and separating them means
// reading one and scrolling for the other.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tag } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { IconCheck, IconTrash } from "@/components/ui/icons";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { AddParty } from "./add-party";
import { useFormat } from "@/lib/ui/use-format";
import { CONTRACT_STATUS_TONE, displayStatus } from "@/lib/contract/status";
import { RENTAL_STATE_TONE, rentalState } from "@/lib/contract/rental-state";
import type { ContractDetail } from "@/lib/data/contracts";

export function StatusStrip({
  contract,
  today,
  canManage,
  action,
}: {
  contract: ContractDetail;
  today: string;
  canManage: boolean;
  /** The contract's own actions. They ride this header because this is the
   *  card that *is* the contract, which is the rule the utlägg page follows
   *  for the same reason: what you can do to a thing belongs to the thing
   *  rather than to the page around it. See components/page-shell.tsx. */
  action?: React.ReactNode;
}) {
  const t = useTranslations("contracts");
  const tRentals = useTranslations("rentals");
  const { date } = useFormat();
  const confirm = useConfirm();
  const { mutate, pending } = useMutation();
  const [adding, setAdding] = useState(false);

  async function removeParty(id: string, name: string) {
    const ok = await confirm({ title: t("party.remove"), message: name, tone: "danger" });
    if (!ok) return;
    await mutate(`/api/contracts/${contract.id}/parties/${id}`, { method: "DELETE", key: id });
  }

  const status = displayStatus(contract, today);

  // A rental carries two states that are not the same question: where the
  // agreement stands, and where the gear is. Both, side by side, because a
  // signed contract whose Soundboks is a week overdue is a row somebody has to
  // act on and "Signerat" alone would not say so.
  const gear = contract.rental
    ? rentalState(
        {
          status: contract.status,
          pickupAt: contract.rental.pickupAt.slice(0, 10),
          returnAt: contract.rental.returnAt.slice(0, 10),
          returnedAt: contract.rental.returnedAt?.slice(0, 10) ?? null,
          checkedAt: contract.rental.checkedAt?.slice(0, 10) ?? null,
        },
        today,
      )
    : null;

  const period =
    contract.validFrom && contract.validTo
      ? t("validity.range", { from: date(contract.validFrom), to: date(contract.validTo) })
      : contract.validFrom
        ? t("validity.fromOnly", { from: date(contract.validFrom) })
        : contract.validTo
          ? t("validity.toOnly", { to: date(contract.validTo) })
          : null;

  return (
    <Card>
      <CardHeader title={t("detail.status")} action={action} />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={CONTRACT_STATUS_TONE[status]}>{t(`status.${status}`)}</Tag>
          {gear && <Tag tone={RENTAL_STATE_TONE[gear]}>{tRentals(`state.${gear}`)}</Tag>}
          {period && <span className="text-sm text-muted">{period}</span>}
        </div>

        {contract.parties.length === 0 ? (
          <p className="text-sm text-muted">{t("detail.noParties")}</p>
        ) : (
          <ul className="space-y-2">
            {contract.parties.map((p) => {
              const signed = p.signedAt !== null;
              return (
                <li key={p.id} className="flex items-start gap-2.5 text-sm">
                  {/* A tick or a hollow ring, in the same slot. The shape says
                      signed or not before the words do, which is what lets this
                      be read at a glance rather than parsed. */}
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                    {signed ? (
                      <IconCheck className="size-4 text-success" />
                    ) : (
                      <span className="size-2 rounded-full border border-muted/60" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted">
                        {[p.title, p.orgName].filter(Boolean).join(" – ") ||
                          t(`detail.partyRole.${p.role}`)}
                      </span>
                    </span>
                    <span className={signed ? "text-xs text-muted" : "text-xs text-warning"}>
                      {signed
                        ? `${t("detail.signedOn", { date: date(p.signedAt!) })}${
                            p.signatureMethod
                              ? ` (${t(`detail.method.${p.signatureMethod}`)})`
                              : ""
                          }`
                        : t("detail.notSigned")}
                      {p.email && <span className="ms-2">{p.email}</span>}
                    </span>
                  </span>
                  {canManage && (
                    <IconButton
                      tone="danger"
                      label={t("party.remove")}
                      disabled={pending === p.id}
                      onClick={() => removeParty(p.id, p.name)}
                    >
                      <IconTrash className="size-4" />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Adding a party lives here too. This is the card that says who has
            signed, so it is the card where somebody is added; a second card
            listing the same people with buttons on it was the same facts
            twice, which is most of what made this page feel like a pile. */}
        {canManage &&
          (adding ? (
            <AddParty contractId={contract.id} onDone={() => setAdding(false)} />
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              {t("detail.addParty")}
            </Button>
          ))}
      </CardBody>
    </Card>
  );
}
