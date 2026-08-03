import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-inset py-4">
          <div>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-1.5 h-3.5 w-56" />
          </div>
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
        <SkeletonTable rows={5} columns={4} toolbar={false} />
      </Card>
    </SkeletonPage>
  );
}
