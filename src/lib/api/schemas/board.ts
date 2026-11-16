// Request bodies for everything under /api/board.
import { z } from "zod";
import { Id, IsoDate, Ore } from "./common";

/**
 * POST /api/board/withdrawals: what a board member took from the stock, several products in one go. `batchId` is
 * made up by the client for this one submit, so a retry writes nothing twice. `memberId` is for the treasurer
 * logging on somebody's behalf.
 */
export const CreateBoardWithdrawal = z.object({
  batchId: z.uuid(),
  occurredAt: IsoDate,
  lines: z
    .array(z.object({ productId: Id, qty: z.int().min(1).max(1000) }))
    .min(1)
    .max(100),
  memberId: Id.optional(),
});
export type CreateBoardWithdrawal = z.infer<typeof CreateBoardWithdrawal>;

/** POST /api/board/prices: what the board pays for a product from a day on. */
export const SetBoardPrice = z.object({
  productId: Id,
  priceOre: Ore.min(0),
  validFrom: IsoDate,
});
export type SetBoardPrice = z.infer<typeof SetBoardPrice>;
