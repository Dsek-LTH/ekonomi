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
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { IconDots, IconUpload } from "@/components/ui/icons";
import { canEditRental } from "@/lib/contract/status";
import type { ContractStatus } from "@/lib/domain/types";

export interface ContractActionState {
  status: ContractStatus;
  isRental: boolean;
  canManage: boolean;
  /** Whether removing it is possible at all: a contract holding signed
   *  evidence is not deletable from any screen. */
  hasSignedFiles: boolean;
}

export function ContractActions({
  state,
  busy,
  onEdit,
  onUpload,
  onRegenerate,
  onTerminate,
  onDelete,
}: {
  state: ContractActionState;
  busy: boolean;
  onEdit: () => void;
  onUpload: () => void;
  onRegenerate: () => void;
  onTerminate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("contracts");
  if (!state.canManage) return null;

  const { status, isRental, hasSignedFiles } = state;

  // What the contract is waiting for, as one labelled button.
  //
  // A draft is waiting to be redrawn or sent; a signed contract is waiting for
  // nothing, so it gets no primary and the menu carries everything. Deciding
  // this from the status rather than always showing the same verb is what makes
  // the header say something instead of offering a fixed row of options.
  const primary =
    isRental && canEditRental(status)
      ? { label: t("rental.regenerate"), onClick: onRegenerate }
      : null;

  return (
    <div className="flex items-center gap-2">
      {primary && (
        <Button size="sm" onClick={primary.onClick} loading={busy}>
          {primary.label}
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
        <MenuItem onClick={onEdit}>{t("detail.edit")}</MenuItem>
        <MenuItem onClick={onUpload}>
          <IconUpload className="size-4" />
          {t("detail.addDocument")}
        </MenuItem>
        {/* Redrawing is deliberately absent once the contract has gone out,
            rather than present and disabled: it would leave two versions in the
            world with nothing saying which was signed, and an option that can
            never be taken is furniture. */}
        {status !== "TERMINATED" && status !== "CANCELLED" && (
          <>
            <MenuSeparator />
            <MenuItem onClick={onTerminate}>{t("detail.terminate")}</MenuItem>
          </>
        )}
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
