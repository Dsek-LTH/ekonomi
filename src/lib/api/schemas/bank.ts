// Request bodies for the bank feed.
import { z } from "zod";
import { Clearable, Id } from "./common";

/** PATCH /api/bank/[id]: which section card a purchase was made on. Clearable: the export names a card only via a trailing K#### in Referens. */
export const PatchBankTransaction = z.object({
  cardId: Clearable(Id),
});
export type PatchBankTransaction = z.infer<typeof PatchBankTransaction>;
