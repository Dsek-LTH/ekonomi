import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonTable, SkeletonPage } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <Card>
        {/* The card header carries the matched/total count and the import
            control, so it is wider than a plain title. */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-inset py-4">
          <div>
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-1.5 h-3.5 w-48" />
          </div>
          <Skeleton className="h-8 w-32 rounded-full" />
        </div>
        <SkeletonTable rows={8} columns={6} tabs />
      </Card>
    </SkeletonPage>
  );
}
