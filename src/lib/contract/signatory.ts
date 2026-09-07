// What a contract calls its signatory, and what it calls itself.
//
// Both were fields on the rental form and neither had to be. The person signing
// for the section holds FIRMATECKNARE through a post the app already knows, so
// asking them to type "Skattmästare" was asking for something it could read;
// and a rental's title is the renter and the fact that it is a rental, which is
// exactly what the form's other answers already say.
//
// Swedish, fixed, and not a translation lookup. Both of these end up on a
// document two parties are bound by, and a contract that renamed its signatory
// because a reader had switched the interface to English would be two
// agreements. Same reason lib/expense/document.ts spells its payment types out.
import type { Role } from "@/lib/domain/types";

/**
 * The post a signatory signs under, in the order it is preferred.
 *
 * Ordered rather than a plain lookup because somebody can hold several. A
 * skattmästare who is also acting ordförande signs as ordförande, which is the
 * senior post and the one a counterparty would expect to see.
 *
 * Only the posts that can plausibly carry firmateckning. The rest return null
 * and the document leaves the line under the name empty, which is honest: the
 * capability is editable, so the section can grant it to a post this list has
 * never heard of, and inventing a title for them would be worse than printing
 * none.
 */
const SIGNATORY_TITLE: readonly { role: Role; title: string }[] = [
  { role: "ORDFORANDE", title: "Ordförande" },
  { role: "SKATTMASTARE", title: "Skattmästare" },
  { role: "VICE_SKATTMASTARE", title: "Vice skattmästare" },
  { role: "SKATTFORMAN", title: "Skattförman" },
];

/** What this person signs as, or null when their post has no standard name. */
export function signatoryTitle(roles: readonly Role[]): string | null {
  return SIGNATORY_TITLE.find((s) => roles.includes(s.role))?.title ?? null;
}

/**
 * What a rental is called in the archive.
 *
 * Derived rather than typed. The list needs a title and the person drawing the
 * contract has already said the only two things one would contain, so asking
 * for it was asking them to write out their own answers. Still stored on the
 * row rather than computed on read, because it is editable afterwards: somebody
 * who wants "Ljud till nollningen" should be able to say so.
 */
export function rentalTitle(counterparty: string): string {
  const who = counterparty.trim();
  return who ? `Uthyrning till ${who}` : "Uthyrning";
}
