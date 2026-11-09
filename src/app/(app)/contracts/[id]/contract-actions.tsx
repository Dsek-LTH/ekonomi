"use client";

// Everything the detail page can do to a contract, in the page header: one labelled button for what the contract is
// waiting for, the rest behind "Mer" (as expense-actions.tsx).
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "@/components/ui/button";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { IconDots, IconUpload } from "@/components/ui/icons";
import type { ContractStatus } from "@/lib/domain/types";

interface ContractActionState {
  /** Null for PROTOCOL/OTHER, which carry no status at all. */
  status: ContractStatus | null;
  isRental: boolean;
  /** Whether the rental can still be changed (until the signed copy is uploaded). False for non-rentals. See canEditRental. */
  editable: boolean;
  /** Where the rental's own form is. Set only for a rental. */
  editHref?: string;
  canManage: boolean;
  /** Whether the signed copy is in the archive. The contract cannot be deleted whole until that file is removed. */
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

  // What the contract is waiting for, as one labelled button. An unsigned rental waits to be finished (its form redraws
  // the document), so that is primary. A signed contract waits for nothing and gets no primary.
  const editsRental = isRental && editable;
  // A draft archived agreement waits for its signed copy; for a rental the form comes first, so its upload is in the menu.
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
        // The word where there is room, three dots where there is not.
        icon={<IconDots className="size-4 sm:hidden" />}
      >
        {/* For a rental, "Ändra" opens the filing (title, tags, notes); the agreement itself is changed on its form. */}
        <MenuItem onClick={onEdit}>{isRental ? t("detail.editRecord") : t("detail.edit")}</MenuItem>
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
        {/* Redrawing is absent once the signed copy is in: two versions with nothing saying which was signed. */}
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
