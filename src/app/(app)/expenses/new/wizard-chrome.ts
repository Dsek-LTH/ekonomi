// The page furniture both claim forms wear.
//
// There are two wizards (the ordinary utlägg and the milersättning) and they
// are different forms on purpose: one has a receipt to upload and a card
// purchase to match, the other has a journey and neither. What they are not
// different about is what the page around them says, and that had been written
// out twice: the same four-way title, the same rule about where "back" goes.
//
// Each keeps its own wording. The shape is shared, the sentences are not: a
// milersättning says "milersättning" in its own namespace, and a form that
// borrowed the utlägg's copy would be a form that called itself the wrong
// thing.
import type { Expense } from "@/lib/domain/types";

/** The five keys a claim form's namespace has to carry to use this. */
export interface WizardTitles {
  (key: "editTitleDraft" | "newTitle" | "editDescription" | "newDescription"): string;
  (key: "editTitle", values: { id: string }): string;
}

export interface WizardChrome {
  title: string;
  description: string;
  back: { href: string; label: string };
}

/**
 * Title, description and back-link for a claim form.
 *
 * A draft has no reference yet. It is numbered when it is submitted for attest,
 * so an edit of one cannot name it and says so instead. Back belongs to the
 * expense being changed when there is one, and to the list when the claim does
 * not exist yet.
 */
export function wizardChrome({
  existing,
  t,
  draftLabel,
  listLabel,
}: {
  existing: Expense | undefined;
  t: WizardTitles;
  /** What to call a draft that has no reference (`expenses.wizard.draftLabel`). */
  draftLabel: string;
  /** The name of the list this returns to (`nav.expenses`). */
  listLabel: string;
}): WizardChrome {
  if (!existing) {
    return {
      title: t("newTitle"),
      description: t("newDescription"),
      back: { href: "/expenses", label: listLabel },
    };
  }
  return {
    title: existing.reference ? t("editTitle", { id: existing.reference }) : t("editTitleDraft"),
    description: t("editDescription"),
    // Editing belongs to the claim it changes; a new one to the list.
    back: { href: `/expenses/${existing.id}`, label: existing.reference ?? draftLabel },
  };
}
