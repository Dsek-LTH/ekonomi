// Request bodies for everything under /api/contracts and /api/rental-items.
//
// Shared with the screens that send them, the same as the expense schemas
// beside this file: one definition, so the archive form and the route it posts
// to cannot drift apart. See lib/api/parse.ts.
import { z } from "zod";
import { MAX_TAG_LENGTH, MAX_TAGS } from "@/lib/contract/tags";
import { Clearable, Id, IsoDate, NonEmpty, Ore, Trimmed } from "./common";

const ContractKind = z.enum(["RENTAL", "SPONSORSHIP", "SUPPLIER", "OTHER"]);
const ContractStatus = z.enum([
  "DRAFT",
  "OUT_FOR_SIGNATURE",
  "SIGNED",
  "TERMINATED",
  "CANCELLED",
]);
const PartyRole = z.enum(["SECTION", "COUNTERPARTY"]);
const SignatureMethod = z.enum(["PAPER", "ELECTRONIC"]);

/**
 * Long enough for a real title, short enough that a pasted contract body is
 * refused rather than stored as one. The same reasoning as the tag cap: the
 * limit is not a guess at how much anyone needs, it is what keeps a mistake
 * from becoming a row nobody can read.
 */
const Title = NonEmpty.max(200);
const Counterparty = NonEmpty.max(200);

/**
 * Tags as they arrive. Validated for shape here and normalised in the route,
 * because normalisation is a rule about the archive rather than about the
 * request, and lib/contract/tags.ts is where the archive's rules live.
 */
const Tags = z.array(Trimmed.max(MAX_TAG_LENGTH)).max(MAX_TAGS);

/** POST /api/contracts: file a contract, with or without a document yet. */
export const CreateContract = z.object({
  kind: ContractKind,
  title: Title,
  counterparty: Counterparty,
  counterpartyOrgNo: Clearable(Trimmed.max(40)).optional(),
  validFrom: Clearable(IsoDate).optional(),
  validTo: Clearable(IsoDate).optional(),
  tags: Tags.default([]),
  notes: Clearable(Trimmed.max(4000)).optional(),
  // An archived contract is normally uploaded as already signed, and that is
  // the ordinary case rather than a shortcut: most of what goes in here was
  // signed years ago. A rental drawn by the app starts as a DRAFT instead.
  status: ContractStatus.default("SIGNED"),
});
export type CreateContract = z.infer<typeof CreateContract>;

/**
 * PATCH /api/contracts/[id]. Every field optional: absent means "leave it".
 *
 * `status` is here too, so the archive can record that a contract was
 * terminated. What it cannot do is change what a signed document says, because
 * the document is a file and this patches the row around it.
 */
export const UpdateContract = z.object({
  kind: ContractKind.optional(),
  title: Title.optional(),
  counterparty: Counterparty.optional(),
  counterpartyOrgNo: Clearable(Trimmed.max(40)).optional(),
  validFrom: Clearable(IsoDate).optional(),
  validTo: Clearable(IsoDate).optional(),
  tags: Tags.optional(),
  notes: Clearable(Trimmed.max(4000)).optional(),
  status: ContractStatus.optional(),
});
export type UpdateContract = z.infer<typeof UpdateContract>;

/** POST /api/contracts/[id]/parties. */
export const CreateParty = z.object({
  role: PartyRole,
  name: NonEmpty.max(120),
  email: Clearable(z.email()).optional(),
  phone: Clearable(Trimmed.max(40)).optional(),
  orgName: Clearable(Trimmed.max(200)).optional(),
  orgNo: Clearable(Trimmed.max(40)).optional(),
  title: Clearable(Trimmed.max(120)).optional(),
  userId: Clearable(Id).optional(),
  // Recording a signature that already happened, which is what filing a scanned
  // contract is. A party added to a draft has neither.
  signedAt: Clearable(IsoDate).optional(),
  signatureMethod: Clearable(SignatureMethod).optional(),
});
export type CreateParty = z.infer<typeof CreateParty>;

export const UpdateParty = CreateParty.partial();
export type UpdateParty = z.infer<typeof UpdateParty>;

// ── Uthyrning ─────────────────────────────────────────────────────

/**
 * One line of gear.
 *
 * The values are sent even when the line came from the catalogue, because a
 * contract states what was agreed on the day it was agreed. The catalogue is
 * where the screen gets its suggestion; it is not what the document reads
 * through. See the RentalLine model.
 */
export const RentalLineInput = z.object({
  itemId: Clearable(Id).optional(),
  description: NonEmpty.max(200),
  quantity: z.int().min(1).max(9999),
  unitPriceOre: Ore.min(0),
  replacementValueOre: Ore.min(0),
});
export type RentalLineInput = z.infer<typeof RentalLineInput>;

/**
 * POST /api/contracts/rental: draw an uthyrningsavtal.
 *
 * One call rather than a draft-then-fill wizard like the expense one. An
 * expense has to exist before a receipt can be attached to it, which is what
 * forces that flow; a rental has nothing to attach until it is complete, so
 * there is no reason to leave half-finished rows behind.
 */
export const CreateRental = z.object({
  title: Title,
  counterparty: Counterparty,
  counterpartyOrgNo: Clearable(Trimmed.max(40)).optional(),
  tags: Tags.default([]),
  notes: Clearable(Trimmed.max(4000)).optional(),

  pickupAt: IsoDate,
  returnAt: IsoDate,
  purpose: Clearable(Trimmed.max(500)).optional(),
  place: Clearable(Trimmed.max(200)).optional(),
  priceOre: Ore.min(0).default(0),
  depositOre: Ore.min(0).default(0),

  lines: z.array(RentalLineInput).min(1).max(100),

  /** Who signs for the section, and who signs for the other side. */
  sectionSignatoryTitle: Clearable(Trimmed.max(120)).optional(),
  counterpartySignatory: z
    .object({
      name: NonEmpty.max(120),
      email: Clearable(z.email()).optional(),
      phone: Clearable(Trimmed.max(40)).optional(),
      title: Clearable(Trimmed.max(120)).optional(),
    })
    .optional(),
});
export type CreateRental = z.infer<typeof CreateRental>;

/**
 * PATCH /api/contracts/[id]/rental: amend a rental while it is still a draft.
 *
 * The route refuses it after that (see canEditRental). Not because a signed
 * contract is sacred as a row, but because the counterparty is reading a
 * document by then, and changing what it says underneath them is the one edit
 * that must not be possible.
 */
export const UpdateRental = z.object({
  pickupAt: IsoDate.optional(),
  returnAt: IsoDate.optional(),
  purpose: Clearable(Trimmed.max(500)).optional(),
  place: Clearable(Trimmed.max(200)).optional(),
  priceOre: Ore.min(0).optional(),
  depositOre: Ore.min(0).optional(),
  lines: z.array(RentalLineInput).min(1).max(100).optional(),
});
export type UpdateRental = z.infer<typeof UpdateRental>;

/**
 * PATCH /api/contracts/[id]/rental/return: the gear came back.
 *
 * Its own call rather than a field on the patch above, because it is the one
 * thing about a rental that stays editable after the contract is signed. Both
 * dates are clearable, since the answer to "has it come back yet" can be
 * corrected to "no" by whoever ticked the wrong row.
 */
export const SettleRental = z.object({
  returnedAt: Clearable(IsoDate).optional(),
  depositReturnedAt: Clearable(IsoDate).optional(),
});
export type SettleRental = z.infer<typeof SettleRental>;

// ── The gear catalogue ────────────────────────────────────────────

export const CreateRentalItem = z.object({
  name: NonEmpty.max(120),
  description: Clearable(Trimmed.max(1000)).optional(),
  dailyPriceOre: Clearable(Ore.min(0)).optional(),
  // Required, and not clearable. An item nobody has valued is an item the
  // liability clause cannot name a figure for.
  replacementValueOre: Ore.min(0),
});
export type CreateRentalItem = z.infer<typeof CreateRentalItem>;

export const UpdateRentalItem = z.object({
  name: NonEmpty.max(120).optional(),
  description: Clearable(Trimmed.max(1000)).optional(),
  dailyPriceOre: Clearable(Ore.min(0)).optional(),
  replacementValueOre: Ore.min(0).optional(),
  active: z.boolean().optional(),
});
export type UpdateRentalItem = z.infer<typeof UpdateRentalItem>;
