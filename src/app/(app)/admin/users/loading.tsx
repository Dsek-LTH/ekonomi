import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonCard, SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";

// The person search on top, the current holders below it.
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonCard action />
      <Card>
        <div className="border-b border-border px-inset py-4">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="mt-1.5 h-3.5 w-60" />
        </div>
        <SkeletonTable rows={6} columns={4} toolbar={false} />
      </Card>
    </SkeletonPage>
  );
}
