"use client";

// The profile as an overlay: a dialog-sized Modal over whatever page it was
// opened from, its title in a top bar beside a close control. Smaller than
// settings (see ../(.)admin/layout.tsx) because it is one form-width column,
// not a list of sections, and on a phone it comes up as a sheet like every
// other dialog.
//
// page.tsx here is a one-line re-export of profile/page.tsx, so this layout is
// the entire difference between the overlay and the route itself.
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Modal } from "@/components/ui/modal";
import { IconX } from "@/components/ui/icons";
import { useGoBack } from "@/components/shell/route-history";
import { SettingsTitleSlot } from "@/components/shell/settings-title";

export default function ProfileOverlayLayout({ children }: { children: React.ReactNode }) {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const backToApp = useGoBack("/dashboard");
  // The top bar's title element, handed to the page so PageShell draws its
  // heading there. See components/shell/settings-title.tsx.
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);

  return (
    <Modal label={tNav("profile")} onClose={backToApp.goBack} className="sm:max-w-2xl">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-inset">
        <div ref={setTitleSlot} className="min-w-0 flex-1" />
        <Link
          href={backToApp.href}
          onClick={backToApp.onClick}
          aria-label={tCommon("close")}
          className="-mr-2 flex size-9 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-hover hover:text-foreground"
        >
          <IconX className="size-5" />
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-inset py-5">
        <SettingsTitleSlot.Provider value={titleSlot}>{children}</SettingsTitleSlot.Provider>
      </div>
    </Modal>
  );
}
