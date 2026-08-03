import { SkeletonPage, SkeletonTableCard } from "@/components/ui/skeleton";

export default function Loading() {
  // The header action is the scope toggle, which only some roles are offered —
  // but it is the common case for anyone who lands here at all.
  return (
    <SkeletonPage action>
      <SkeletonTableCard rows={6} columns={6} tabs />
    </SkeletonPage>
  );
}
