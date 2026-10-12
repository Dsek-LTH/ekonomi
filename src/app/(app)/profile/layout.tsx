import { Suspense } from "react";

import { SettingsBounce } from "@/components/shell/settings-bounce";

// The profile is only ever the overlay in @modal/(.)profile, the same as
// settings. Loading /profile directly (a reload, a link in an email, Fortnox
// sending you back after a login) lands here, and this sends you round to it.
// `children` is deliberately not rendered: the page under here exists to be
// re-exported by the overlay.
export default function ProfileLayout() {
  return (
    <Suspense fallback={null}>
      <SettingsBounce />
    </Suspense>
  );
}
