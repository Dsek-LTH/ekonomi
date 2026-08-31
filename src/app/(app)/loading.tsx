import { SkeletonPage, SkeletonTableCard } from "@/components/ui/skeleton";

// The fallback for any route inside the app shell that hasn't declared a shape
// of its own, including /admin, which only redirects. Every route that renders
// something has its own loading.tsx next to its page.tsx, and the nearest one
// wins, so this is the floor rather than the common case.
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonTableCard rows={6} />
    </SkeletonPage>
  );
}
