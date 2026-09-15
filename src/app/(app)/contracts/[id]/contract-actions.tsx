"use client";

// Everything the detail page can do to a contract, in the page header.
//
// It used to be four buttons in four card headers plus a delete at the very
// bottom, so doing anything meant scrolling to find where that particular verb
// had been put. The expense page learned this already: see the note at the top
// of expense-actions.tsx. One labelled button for the thing the contract is
// actually waiting for, everything else behind "Mer", and the body below is
// then only a description of the contract rather than a description with
// controls scattered through it.
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "@/components/ui/button";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { IconDots, IconUpload } from "@/components/ui/icons";
import type { ContractStatus } from "@/lib/domain/types";

export interface ContractActionState {
  /** Null for PROTOCOL/OTHER, which carry no status at all. */
  status: ContractStatus | null;
  isRental: boolean;
  /** Whether the rental can still be changed, which is until the signed copy is uploaded.
   *  False for anything that is not a rental. See canEditRental. */
  editable: boolean;
  /** Where the rental's own form is. Set only for a rental. */
  editHref?: string;
  canManage: boolean;
  /** Whether the signed copy is in the archive. The contract cannot be deleted
   *  whole until that file has been removed on its own. */
  hasSignedFiles: boolean;
}

export function ContractActions({
  state,
  busy,
  onEdit,
  onUpload,
  onRegenerate,
  onUploadSigned,
  onDelete,
}: {
  state: ContractActionState;
  busy: boolean;
  onEdit: () => void;
  onUpload: () => void;
  onRegenerate: () => void;
  /** Opens the picker for the signed copy, which makes the contract Signerat. */
  onUploadSigned: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("contracts");
  if (!state.canManage) return null;

  const { status, isRental, editable, editHref, hasSignedFiles } = state;

  // What the contract is waiting for, as one labelled button.
  //
  // A rental nobody has signed is waiting to be finished, so its primary is the
  // form it was drawn on, which redraws the document on save. A signed contract
  // is waiting for nothing, so it gets no primary and the menu carries
  // everything. Deciding this from the state rather than always showing the
  // same verb is what makes the header say something instead of offering a
  // fixed row of options.
  const editsRental = isRental && editable;
  // An archived agreement that is still a draft is waiting for its signed
  // copy, and uploading it is what makes it Signerat. A rental waits for the
  // same thing, but its form comes first, so there the upload is in the menu.
  const awaitsSignedCopy = status === "DRAFT" && !isRental;

  return (
    <div className="flex items-center gap-2">
      {editsRental && editHref && (
        <ButtonLink size="sm" href={editHref}>
          {t("rental.edit")}
        </ButtonLink>
      )}
      {awaitsSignedCopy && (
        <Button size="sm" onClick={onUploadSigned} loading={busy}>
          {t("detail.uploadSigned")}
        </Button>
      )}
      <Menu
        label={t("detail.more")}
        variant="secondary"
        size="sm"
        disabled={busy}
        compact
        // The word where there is room for it, three dots where there is not.
        // Both would be saying the same thing twice.
        icon={<IconDots className="size-4 sm:hidden" />}
      >
        {/* For a rental the agreement itself is changed on its form, above.
            What this opens is the filing around it: title, tags and notes. */}
        <MenuItem onClick={onEdit}>
          {isRental ? t("detail.editRecord") : t("detail.edit")}
        </MenuItem>
        {status === "DRAFT" && isRental && (
          <MenuItem onClick={onUploadSigned}>
            <IconUpload className="size-4" />
            {t("detail.uploadSigned")}
          </MenuItem>
        )}
        <MenuItem onClick={onUpload}>
          <IconUpload className="size-4" />
          {t("detail.addDocument")}
        </MenuItem>
        {/* Redrawing is deliberately absent once the signed copy is in, rather
            than present and disabled: it would leave two versions in the world
            with nothing saying which was signed, and an option that can never
            be taken is furniture. */}
        {editsRental && <MenuItem onClick={onRegenerate}>{t("rental.regenerate")}</MenuItem>}
        <MenuSeparator />
        <MenuItem
          onClick={onDelete}
          disabled={hasSignedFiles}
          className="text-danger hover:bg-danger-soft"
        >
          {t("detail.deleteContract")}
        </MenuItem>
      </Menu>
    </div>
  );
}
