// Request bodies for the bank feed.
import { z } from "zod";
import { Clearable, Id } from "./common";

/**
 * PATCH /api/bank/[id]: which section card a purchase was made on.
 *
 * Clearable, because the assignment is a judgement rather than a fact off the
 * CSV: the export only names a card when the Referens carries a trailing
 * K####, and a row put on the wrong card has to be able to come off it again.
 */
export const PatchBankTransaction = z.object({
  cardId: Clearable(Id),
});
export type PatchBankTransaction = z.infer<typeof PatchBankTransaction>;
