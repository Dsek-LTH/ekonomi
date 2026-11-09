import { Suspense } from "react";

import { SettingsBounce } from "@/components/shell/settings-bounce";

export default function AdminLayout() {
  return (
    <Suspense fallback={null}>
      <SettingsBounce />
    </Suspense>
  );
}
