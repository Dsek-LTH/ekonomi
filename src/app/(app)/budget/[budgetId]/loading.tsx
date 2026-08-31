import { SkeletonPage, SkeletonSheet, SkeletonSidebarLayout } from "@/components/ui/skeleton";

// The heaviest page in the app (a whole budget with every cost centre, its
// variables and its changes) so it is the one where the wait is most worth
// drawing. Cost-centre list on the left, the sheet beside it.
export default function Loading() {
  return (
    <SkeletonPage back description={false} action titleWidth="w-40">
      <SkeletonSidebarLayout items={8}>
        <SkeletonSheet rows={14} />
      </SkeletonSidebarLayout>
    </SkeletonPage>
  );
}
