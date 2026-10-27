// The one way to read BookkeepingSettings.
//
// Every value here is a decision, and none has a default. Null means nobody
// has made it yet, and whatever needs it refuses until somebody does: posting
// to an account this app picked would put the section's money somewhere
// nobody chose. No row at all is the same as a row where nothing is chosen.
import "server-only";

import { prisma } from "@/lib/server/db";

export interface BookkeepingSettingsValues {
  bankAccount: string | null;
  memberDebtAccount: string | null;
  zettleClearingAccount: string | null;
  swishClearingAccount: string | null;
  zettleFeeAccount: string | null;
  zettleFeeCostCenterId: string | null;
  zettleFeeCostCenterCode: string | null;
  /** Null means "the same series as everything else", which is itself a choice
   *  the settings screen offers. See incomeVoucherSeries. */
  incomeVoucherSeries: string | null;
}

export async function loadBookkeepingSettings(): Promise<BookkeepingSettingsValues> {
  const row = await prisma.bookkeepingSettings.findUnique({
    where: { id: "singleton" },
    include: { zettleFeeCostCenter: { select: { code: true } } },
  });
  return {
    bankAccount: row?.bankAccount ?? null,
    memberDebtAccount: row?.memberDebtAccount ?? null,
    zettleClearingAccount: row?.zettleClearingAccount ?? null,
    swishClearingAccount: row?.swishClearingAccount ?? null,
    zettleFeeAccount: row?.zettleFeeAccount ?? null,
    zettleFeeCostCenterId: row?.zettleFeeCostCenterId ?? null,
    zettleFeeCostCenterCode: row?.zettleFeeCostCenter?.code ?? null,
    incomeVoucherSeries: row?.incomeVoucherSeries ?? null,
  };
}
