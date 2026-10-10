import { Skeleton, SkeletonPage, SkeletonSheet } from "@/components/ui/skeleton";

// The heaviest page in the app (a whole budget with every cost centre, its
// variables and its changes) so it is the one where the wait is most worth
// drawing. It opens on the rambudget: the title with the view switch beside
// it, the row with the comparison and the lock, and the sheet across the full
// width, with no list of cost centres beside it.
export default function Loading() {
  return (
    <SkeletonPage back action titleWidth="w-64">
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-full rounded-control sm:h-9 sm:w-72" />
        <Skeleton className="ml-auto hidden h-8 w-36 rounded-control sm:block" />
      </div>
      <SkeletonSheet rows={14} />
    </SkeletonPage>
  );
}
