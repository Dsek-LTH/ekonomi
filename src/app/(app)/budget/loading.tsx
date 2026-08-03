import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage action>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-inset py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
        <SkeletonTable rows={5} columns={5} />
      </Card>
    </SkeletonPage>
  );
}
