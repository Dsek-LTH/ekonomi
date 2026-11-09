"use client";

// The agreement at a glance: where it stands and the facts it turns on, each said once. Signerat means the signed copy is
// in the archive and nothing else (lib/contract/status.ts), so a draft says what would change that.
import { useTranslations } from "next-intl";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tag } from "@/components/ui/status-pill";
import { Amount } from "@/components/ui/amount";
import { useFormat } from "@/lib/ui/use-format";
import { oreToSEK } from "@/lib/domain/money";
import { CONTRACT_STATUS_TONE, displayStatus } from "@/lib/contract/status";
import { RENTAL_STATE_TONE, rentalState } from "@/lib/contract/rental-state";
import type { ContractDetail } from "@/lib/data/contracts";
import { Fact, Facts } from "./facts";

export function StatusStrip({
  contract,
  today,
  action,
}: {
  contract: ContractDetail;
  today: string;
  /** The contract's own actions; they ride this header because this card is the contract (see components/page-shell.tsx). */
  action?: React.ReactNode;
}) {
  const t = useTranslations("contracts");
  const tRentals = useTranslations("rentals");
  const { date } = useFormat();
  const { rental } = contract;

  // Only rendered for a CONTRACT (see contract-client.tsx), which always has a status.
  const status = displayStatus(contract, today)!;

  // A rental has two states: where the agreement stands and where the gear is. Both, so overdue gear on a signed contract shows.
  const gear = rental
    ? rentalState(
        {
          pickupAt: rental.pickupAt.slice(0, 10),
          returnAt: rental.returnAt.slice(0, 10),
          returnedAt: rental.returnedAt?.slice(0, 10) ?? null,
          checkedAt: rental.checkedAt?.slice(0, 10) ?? null,
        },
        today,
      )
    : null;

  // A rental's own dates, which the contract actually states, not the archive's copy.
  const from = rental?.pickupAt ?? contract.validFrom;
  const to = rental?.returnAt ?? contract.validTo;
  const period =
    from && to
      ? t("validity.range", { from: date(from), to: date(to) })
      : from
        ? t("validity.fromOnly", { from: date(from) })
        : to
          ? t("validity.toOnly", { to: date(to) })
          : t("validity.none");

  const contact = [contract.counterpartyEmail, contract.counterpartyPhone]
    .filter(Boolean)
    .join(" - ");

  return (
    <Card>
      <CardHeader title={t("detail.status")} action={action} />
      <CardBody className="space-y-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={CONTRACT_STATUS_TONE[status]}>{t(`status.${status}`)}</Tag>
            {gear && <Tag tone={RENTAL_STATE_TONE[gear]}>{tRentals(`state.${gear}`)}</Tag>}
          </div>
          {contract.status === "DRAFT" && (
            <p className="text-xs text-muted">{t("detail.draftHint")}</p>
          )}
        </div>

        <Facts>
          <Fact label={rental ? t("rental.counterparty") : t("col.counterparty")}>
            <span className="block font-medium">{contract.counterparty ?? "-"}</span>
            {contract.counterpartyOrgNo && (
              <span className="block text-muted">{contract.counterpartyOrgNo}</span>
            )}
            {contact && <span className="block text-muted">{contact}</span>}
          </Fact>
          <Fact label={rental ? t("rental.sectionPeriod") : t("col.validity")}>{period}</Fact>
          {rental && (
            <>
              <Fact label={t("rental.price")}>
                <Amount value={oreToSEK(rental.priceOre)} />
              </Fact>
              <Fact label={t("rental.signatureCount")}>{rental.signatureCount}</Fact>
              {rental.purpose && (
                <Fact label={t("rental.purpose")} wide>
                  <span className="whitespace-pre-line">{rental.purpose}</span>
                </Fact>
              )}
            </>
          )}
        </Facts>
      </CardBody>
    </Card>
  );
}
