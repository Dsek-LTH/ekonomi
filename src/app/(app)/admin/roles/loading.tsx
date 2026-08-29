import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonCard, SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";

// The group mapping on top, the role × permission grid below it. Seven columns
// because the grid has one per role, so the placeholder is the shape of the
// thing rather than a generic table.
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonCard action />
      <Card>
        <div className="border-b border-border px-inset py-4">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-1.5 h-3.5 w-72" />
        </div>
        <SkeletonTable rows={8} columns={7} toolbar={false} />
      </Card>
    </SkeletonPage>
  );
}
