// Request bodies for everything under /api/contracts and /api/rental-items, shared with the sending screens.
import { z } from "zod";
import { MAX_TAG_LENGTH, MAX_TAGS } from "@/lib/contract/tags";
import { Clearable, Id, IsoDate, NonEmpty, Ore, Trimmed } from "./common";

const ContractKind = z.enum(["CONTRACT", "PROTOCOL", "OTHER"]);

/** Long enough for a real title, short enough that a pasted contract body is refused. */
const Title = NonEmpty.max(200);
const Counterparty = NonEmpty.max(200);

/**
 * Who the renter is, well enough to reach them. Required on a rental, optional elsewhere (a scanned 2019 sponsoravtal
 * has whatever the scan says). `RenterOrgNo` takes an organisationsnummer or personnummer and is not shape-validated:
 * a checksum would refuse foreign or samordningsnummer numbers.
 */
const RenterOrgNo = NonEmpty.max(40);
const RenterAddress = NonEmpty.max(200);
const RenterPostalCode = NonEmpty.max(20);
const RenterCity = NonEmpty.max(100);

/** Tags as they arrive: shape validated here, normalised in the route (lib/contract/tags.ts holds the archive's rules). */
const Tags = z.array(Trimmed.max(MAX_TAG_LENGTH)).max(MAX_TAGS);

/** The optional details a contract carries, shared by create and edit so they cannot drift. */
const CONTRACT_DETAILS = {
  counterpartyOrgNo: Clearable(Trimmed.max(40)).optional(),
  counterpartyAddress: Clearable(Trimmed.max(200)).optional(),
  counterpartyPostalCode: Clearable(Trimmed.max(20)).optional(),
  counterpartyCity: Clearable(Trimmed.max(100)).optional(),
  /** The directory row the fields above were copied from, if any. */
  counterpartyId: Clearable(Id).optional(),
  validFrom: Clearable(IsoDate).optional(),
  validTo: Clearable(IsoDate).optional(),
  /** The one date a lean document (PROTOCOL, OTHER) needs. Ignored for
   *  CONTRACT, which states a period instead. */
  date: Clearable(IsoDate).optional(),
  notes: Clearable(Trimmed.max(4000)).optional(),
};

/**
 * POST /api/contracts: file a document, with or without a file yet. `counterparty` and `date` are enforced by the
 * refine below because which applies depends on `kind`.
 */
export const CreateContract = z
  .object({
    kind: ContractKind,
    title: Title,
    counterparty: Trimmed.max(200),
    ...CONTRACT_DETAILS,
    tags: Tags.default([]),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "CONTRACT" && d.counterparty === "") {
      ctx.addIssue({
        code: "custom",
        path: ["counterparty"],
        message: "Counterparty is required for this kind",
      });
    }
    // A meeting's minutes is never with anybody. OTHER may optionally name one.
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

/** PATCH /api/contracts/[id]. Absent means "leave it". No status: signed is whether the signed copy is archived (lib/contract/status.ts). */
export const UpdateContract = z.object({
  kind: ContractKind.optional(),
  title: Title.optional(),
  counterparty: Counterparty.optional(),
  ...CONTRACT_DETAILS,
  tags: Tags.optional(),
});
export type UpdateContract = z.infer<typeof UpdateContract>;

// ── Uthyrning ─────────────────────────────────────────────────────

/** One line of gear. Values are sent even when it came from the catalogue: a contract states what was agreed that day. See RentalLine. */
const RentalLineInput = z.object({
  itemId: Clearable(Id).optional(),
  description: NonEmpty.max(200),
  quantity: z.int().min(1).max(9999),
  unitPriceOre: Ore.min(0),
  /** What comes off this line, 0 to 100. See rental/pricing.ts. */
  discountPercent: z.int().min(0).max(100).default(0),
  replacementValueOre: Ore.min(0),
});
type RentalLineInput = z.infer<typeof RentalLineInput>;

/** How many signature blocks one rental may ask for (a cap against a typo drawing blank pages). */
export const MAX_SIGNATURES = 10;

/**
 * POST /api/contracts/rental: draw an uthyrningsavtal. Also the body of PUT /api/contracts/[id]/rental, which amends one
 * by sending the whole form again.
 */
export const CreateRental = z.object({
  // No title (derived in lib/contract/signatory.ts), tags or notes (editable on the contract itself).
  counterparty: Counterparty,
  counterpartyOrgNo: RenterOrgNo,
  counterpartyAddress: RenterAddress,
  counterpartyPostalCode: RenterPostalCode,
  counterpartyCity: RenterCity,
  /** How to reach the renter other than by post; printed in the party block when given. */
  counterpartyEmail: Clearable(z.email()).optional(),
  counterpartyPhone: Clearable(Trimmed.max(40)).optional(),
  /** The directory row the fields above were copied from, if any. */
  counterpartyId: Clearable(Id).optional(),

  pickupAt: IsoDate,
  returnAt: IsoDate,
  /** Required: the villkor forbid other use, and that clause needs a stated purpose to point at. */
  purpose: NonEmpty.max(500),

  /** No money beyond the lines: the rent is computed by lib/contract/rental/pricing.ts, which the form also calls. */
  lines: z.array(RentalLineInput).min(1).max(100),

  /** How many renter signature blocks to draw (a number, since who signs for an organisation is rarely known yet). */
  signatureCount: z.int().min(1).max(MAX_SIGNATURES),
});
export type CreateRental = z.infer<typeof CreateRental>;

/**
 * POST /api/contracts/rental/preview: draw the document for an unsaved form. Not `CreateRental.partial()`: nothing is
 * required, so an incomplete form still previews. The caps still apply because a render is a way to spend a server.
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
 * PATCH /api/contracts/[id]/rental/record: what actually happened. Its own call because it stays editable after signing
 * (what was agreed is frozen). Every field is clearable.
 */
export const RecordRental = z.object({
  returnedAt: Clearable(IsoDate).optional(),
  /** When it was inspected and accepted; the villkor turn on this rather than `returnedAt` (rental/terms.ts). */
  checkedAt: Clearable(IsoDate).optional(),
  /** State at handover and at return; a claim is the difference. */
  conditionOut: Clearable(Trimmed.max(2000)).optional(),
  conditionIn: Clearable(Trimmed.max(2000)).optional(),
});
export type RecordRental = z.infer<typeof RecordRental>;

// ── The gear catalogue ────────────────────────────────────────────

export const CreateRentalItem = z.object({
  name: NonEmpty.max(120),
  /** How many the section owns. At least one. */
  quantity: z.int().min(1).max(9999).default(1),
  description: Clearable(Trimmed.max(1000)).optional(),
  dailyPriceOre: Clearable(Ore.min(0)).optional(),
  // Required and not clearable: the liability clause needs a value figure.
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
