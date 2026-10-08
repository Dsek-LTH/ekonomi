import { Suspense } from "react";

import { SettingsBounce } from "@/components/shell/settings-bounce";

// Settings are only ever the overlay in @modal/(.)admin. Loading /admin
// directly lands here, and this sends you round to it. See SettingsBounce.
// `children` is deliberately not rendered: the pages under here exist to be
// re-exported by the overlay.
export default function AdminLayout() {
  return (
    <Suspense fallback={null}>
      <SettingsBounce />
    </Suspense>
  );
}
