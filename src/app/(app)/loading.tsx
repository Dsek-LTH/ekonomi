import { SkeletonPage, SkeletonTableCard } from "@/components/ui/skeleton";

// The fallback for any route inside the app shell without its own loading.tsx (the floor, not the common case).
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonTableCard rows={6} />
    </SkeletonPage>
  );
}
