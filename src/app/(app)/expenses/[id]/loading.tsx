import { Skeleton, SkeletonCard, SkeletonDetailList, SkeletonPage } from "@/components/ui/skeleton";

// The header here names the expense three times over (title, then id and
// submitter, then the status pill) and the action slot holds the whole attest
// row, so it is the widest header in the app.
export default function Loading() {
  return (
    <SkeletonPage width="content" back description={false} action titleWidth="w-72">
      <Skeleton className="h-4 w-40" />
      <SkeletonCard>
        <SkeletonDetailList rows={6} />
      </SkeletonCard>
      <SkeletonCard>
        <SkeletonDetailList rows={3} />
      </SkeletonCard>
    </SkeletonPage>
  );
}
