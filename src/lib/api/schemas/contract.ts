// Request bodies for everything under /api/contracts and /api/rental-items.
//
// Shared with the screens that send them, the same as the expense schemas
// beside this file: one definition, so the archive form and the route it posts
// to cannot drift apart. See lib/api/parse.ts.
import { z } from "zod";
import { MAX_TAG_LENGTH, MAX_TAGS } from "@/lib/contract/tags";
import { Clearable, Id, IsoDate, NonEmpty, Ore, Trimmed } from "./common";

const ContractKind = z.enum(["CONTRACT", "PROTOCOL", "OTHER"]);

/**
 * Long enough for a real title, short enough that a pasted contract body is
 * refused rather than stored as one. The same reasoning as the tag cap: the
 * limit is not a guess at how much anyone needs, it is what keeps a mistake
 * from becoming a row nobody can read.
 */
const Title = NonEmpty.max(200);
const Counterparty = NonEmpty.max(200);

/**
 * Who the renter is, well enough to reach them.
 *
 * Required on a rental and optional everywhere else, which is the difference
 * between drawing a contract and filing one. A 2019 sponsoravtal arriving as a
 * scan has whatever the scan says on it. A contract this app draws is one the
 * section may have to enforce over a broken speaker, and a name with no number
 * and no address behind it is not somebody who can be pursued.
 *
 * `RenterOrgNo` takes an organisationsnummer or a personnummer without caring
 * which: the renter is a company, another section, or a private person, and the
 * field is the same question either way. Not validated for shape. A checksum
 * rule that refuses a foreign organisation's number, or a samordningsnummer,
 * would block a real rental to save nobody from anything, and what the number
 * is for is being written on the document.
 */
const RenterOrgNo = NonEmpty.max(40);
const RenterAddress = NonEmpty.max(200);
const RenterPostalCode = NonEmpty.max(20);
const RenterCity = NonEmpty.max(100);

/**
 * Tags as they arrive. Validated for shape here and normalised in the route,
 * because normalisation is a rule about the archive rather than about the
 * request, and lib/contract/tags.ts is where the archive's rules live.
 */
const Tags = z.array(Trimmed.max(MAX_TAG_LENGTH)).max(MAX_TAGS);

/**
 * POST /api/contracts: file a document, with or without a file yet.
 *
 * `counterparty` and `date` are both trimmed/optional at the field level and
 * enforced by the refine below instead: which of them applies depends on
 * `kind` (an agreement needs a counterparty and states a period; a lean
 * document needs a date and nothing else), and a rule that can see `kind`
 * is not something a single field's own type can express.
 */
export const CreateContract = z
  .object({
    kind: ContractKind,
    title: Title,
    counterparty: Trimmed.max(200),
    counterpartyOrgNo: Clearable(Trimmed.max(40)).optional(),
    counterpartyAddress: Clearable(Trimmed.max(200)).optional(),
    counterpartyPostalCode: Clearable(Trimmed.max(20)).optional(),
    counterpartyCity: Clearable(Trimmed.max(100)).optional(),
    /** The directory row the fields above were copied from, if any. See
     *  Counterparty and CreateCounterparty below. */
    counterpartyId: Clearable(Id).optional(),
    validFrom: Clearable(IsoDate).optional(),
    validTo: Clearable(IsoDate).optional(),
    /** The one date a lean document (PROTOCOL, OTHER) needs. Ignored for
     *  CONTRACT, which states a period instead. */
    date: Clearable(IsoDate).optional(),
    tags: Tags.default([]),
    notes: Clearable(Trimmed.max(4000)).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "CONTRACT" && d.counterparty === "") {
      ctx.addIssue({
        code: "custom",
        path: ["counterparty"],
        message: "Counterparty is required for this kind",
      });
    }
    // A meeting's minutes is never with anybody. OTHER may optionally name
    // one; see AgreementDetails.counterparty.
    if (d.kind === "PROTOCOL" && d.counterparty !== "") {
      ctx.addIssue({
        code: "custom",
        path: ["counterparty"],
        message: "A meeting's minutes cannot name a counterparty",
      });
    }
    // Left to the filer for OTHER, but a protocol is pretty much just a date.
    if (d.kind === "PROTOCOL" && !d.date) {
      ctx.addIssue({
        code: "custom",
        path: ["date"],
        message: "A date is required for this kind",
      });
    }
  });
export type CreateContract = z.infer<typeof CreateContract>;

/**
 * PATCH /api/contracts/[id]. Every field optional: absent means "leave it".
 *
 * No status. Whether a contract is signed is whether its signed copy is in the
 * archive, which is a file rather than a field. See lib/contract/status.ts.
 */
export const UpdateContract = z.object({
  kind: ContractKind.optional(),
  title: Title.optional(),
  counterparty: Counterparty.optional(),
  counterpartyOrgNo: Clearable(Trimmed.max(40)).optional(),
  counterpartyAddress: Clearable(Trimmed.max(200)).optional(),
  counterpartyPostalCode: Clearable(Trimmed.max(20)).optional(),
  counterpartyCity: Clearable(Trimmed.max(100)).optional(),
  counterpartyId: Clearable(Id).optional(),
  validFrom: Clearable(IsoDate).optional(),
  validTo: Clearable(IsoDate).optional(),
  date: Clearable(IsoDate).optional(),
  tags: Tags.optional(),
  notes: Clearable(Trimmed.max(4000)).optional(),
});
export type UpdateContract = z.infer<typeof UpdateContract>;

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
  /** What comes off this line, 0 to 100. See rental/pricing.ts. */
  discountPercent: z.int().min(0).max(100).default(0),
  replacementValueOre: Ore.min(0),
});
export type RentalLineInput = z.infer<typeof RentalLineInput>;

/**
 * How many signature blocks one rental may ask for. A board signing jointly is
 * a handful, and the cap is what keeps a typo from drawing a page of blank
 * signature blocks.
 */
export const MAX_SIGNATURES = 10;

/**
 * POST /api/contracts/rental: draw an uthyrningsavtal. Also the body of
 * PUT /api/contracts/[id]/rental, which amends one by sending the whole form
 * again.
 *
 * One call rather than a draft-then-fill wizard like the expense one. An
 * expense has to exist before a receipt can be attached to it, which is what
 * forces that flow; a rental has nothing to attach until it is complete, so
 * there is no reason to leave half-finished rows behind.
 */
export const CreateRental = z.object({
  // No title, no tags, no notes.
  //
  // The title is derived (lib/contract/signatory.ts): a rental's is the renter
  // and the fact that it is a rental, both of which the answers below already
  // give. Tags are archive machinery for filing a sponsoravtal, and you find a
  // rental by its renter or its gear. Notes are worth having and worth nothing
  // at the moment of drawing, so they stay editable on the contract itself.
  // All three were fields somebody filled in to tell the app what it knew.
  counterparty: Counterparty,
  counterpartyOrgNo: RenterOrgNo,
  counterpartyAddress: RenterAddress,
  counterpartyPostalCode: RenterPostalCode,
  counterpartyCity: RenterCity,
  /** How to reach the renter other than by post. Optional, and printed in the
   *  renter's party block when given. */
  counterpartyEmail: Clearable(z.email()).optional(),
  counterpartyPhone: Clearable(Trimmed.max(40)).optional(),
  /** The directory row the fields above were copied from, if any. */
  counterpartyId: Clearable(Id).optional(),

  pickupAt: IsoDate,
  returnAt: IsoDate,
  /** Required: the villkor forbid using the gear for any other purpose than
   *  the one stated, and that clause needs something on the page to point at. */
  purpose: NonEmpty.max(500),

  /**
   * No money here beyond the lines.
   *
   * The rent is the lines less their own discounts, worked out by
   * lib/contract/rental/pricing.ts on the way in, because a price the client
   * computes and the server stores is a price the two can disagree about. The
   * form shows the same figure by calling the same function.
   */
  lines: z.array(RentalLineInput).min(1).max(100),

  /**
   * How many signature blocks the document draws for the renter. A number
   * rather than names: who signs for an organisation is rarely known when the
   * contract is drawn, and a private person is already named as the renter.
   */
  signatureCount: z.int().min(1).max(MAX_SIGNATURES),
});
export type CreateRental = z.infer<typeof CreateRental>;

/**
 * POST /api/contracts/rental/preview: draw the document for a form nobody has
 * saved yet.
 *
 * Deliberately not `CreateRental.partial()`. This is the shape of a form being
 * filled in, and every rule that makes `CreateRental` refuse an incomplete
 * request is a rule that would blank the preview at exactly the moment it is
 * most use. So nothing is required, a line may have no description, and the
 * period may be half a date. The route writes nothing, so there is no row to
 * protect; what it still enforces is the caps, because a preview is a render
 * and a render of ten thousand lines is a way to spend a server.
 */
export const PreviewRental = z.object({
  counterparty: Trimmed.max(200).default(""),
  counterpartyOrgNo: Trimmed.max(40).default(""),
  counterpartyAddress: Trimmed.max(200).default(""),
  counterpartyPostalCode: Trimmed.max(20).default(""),
  counterpartyCity: Trimmed.max(100).default(""),
  counterpartyEmail: Trimmed.max(200).default(""),
  counterpartyPhone: Trimmed.max(40).default(""),
  /** Whole days only. The form holds a mask and sends nothing until it is one. */
  pickupAt: IsoDate.nullable().default(null),
  returnAt: IsoDate.nullable().default(null),
  purpose: Trimmed.max(500).default(""),
  lines: z
    .array(
      z.object({
        description: Trimmed.max(200).default(""),
        quantity: z.int().min(0).max(9999).default(0),
        unitPriceOre: Ore.min(0).default(0),
        discountPercent: z.int().min(0).max(100).default(0),
        replacementValueOre: Ore.min(0).default(0),
      }),
    )
    .max(100)
    .default([]),
  signatureCount: z.int().min(1).max(MAX_SIGNATURES).default(1),
});
export type PreviewRental = z.infer<typeof PreviewRental>;

/**
 * PATCH /api/contracts/[id]/rental/record: what actually happened.
 *
 * Its own call rather than a field on the patch above, because this is the one
 * part of a rental that stays editable after the contract is signed. What was
 * agreed is frozen; when the gear went out, came back and was accepted is a
 * record of events, and a record has to be writable when the events occur.
 *
 * Every field is clearable, since each of these is an answer somebody can tick
 * on the wrong row and have to correct.
 */
export const RecordRental = z.object({
  returnedAt: Clearable(IsoDate).optional(),
  /** When it was inspected and accepted. The villkor turn on this rather than
   *  on `returnedAt`; see rental/terms.ts. */
  checkedAt: Clearable(IsoDate).optional(),
  /** What state it was in at handover, and at return. A claim is the
   *  difference between the two. */
  conditionOut: Clearable(Trimmed.max(2000)).optional(),
  conditionIn: Clearable(Trimmed.max(2000)).optional(),
});
export type RecordRental = z.infer<typeof RecordRental>;

// ── The gear catalogue ────────────────────────────────────────────

export const CreateRentalItem = z.object({
  name: NonEmpty.max(120),
  /** How many the section owns. At least one, because a catalogue row for
   *  nothing is a row that can never be lent. */
  quantity: z.int().min(1).max(9999).default(1),
  description: Clearable(Trimmed.max(1000)).optional(),
  dailyPriceOre: Clearable(Ore.min(0)).optional(),
  // Required, and not clearable. An item nobody has valued is an item the
  // liability clause cannot name a figure for.
  replacementValueOre: Ore.min(0),
});
export type CreateRentalItem = z.infer<typeof CreateRentalItem>;

export const UpdateRentalItem = z.object({
  name: NonEmpty.max(120).optional(),
  quantity: z.int().min(1).max(9999).optional(),
  description: Clearable(Trimmed.max(1000)).optional(),
  dailyPriceOre: Clearable(Ore.min(0)).optional(),
  replacementValueOre: Ore.min(0).optional(),
});
export type UpdateRentalItem = z.infer<typeof UpdateRentalItem>;

// ── The counterparty directory ─────────────────────────────────────

export const CreateCounterparty = z.object({
  name: NonEmpty.max(200),
  orgNo: Clearable(Trimmed.max(40)).optional(),
  address: Clearable(Trimmed.max(200)).optional(),
  postalCode: Clearable(Trimmed.max(20)).optional(),
  city: Clearable(Trimmed.max(100)).optional(),
  email: Clearable(z.email()).optional(),
  phone: Clearable(Trimmed.max(40)).optional(),
  notes: Clearable(Trimmed.max(1000)).optional(),
});
export type CreateCounterparty = z.infer<typeof CreateCounterparty>;

export const UpdateCounterparty = z.object({
  name: NonEmpty.max(200).optional(),
  orgNo: Clearable(Trimmed.max(40)).optional(),
  address: Clearable(Trimmed.max(200)).optional(),
  postalCode: Clearable(Trimmed.max(20)).optional(),
  city: Clearable(Trimmed.max(100)).optional(),
  email: Clearable(z.email()).optional(),
  phone: Clearable(Trimmed.max(40)).optional(),
  notes: Clearable(Trimmed.max(1000)).optional(),
});
export type UpdateCounterparty = z.infer<typeof UpdateCounterparty>;
