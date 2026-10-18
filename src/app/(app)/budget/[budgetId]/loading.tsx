import { Skeleton, SkeletonPage, SkeletonSheet } from "@/components/ui/skeleton";

// The heaviest page in the app (a whole budget with every cost centre, its
// variables and its changes) so it is the one where the wait is most worth
// drawing. It opens on the detail view: the header (the way back, the title
// with the antagen date under it, and the comparison and the lock at its far
// end, see the page's `aside`), then the list of cost centres beside the first one's sheet, from
// lg, where the page puts them side by side. The view switch is in the
// section's band above, which stays.
export default function Loading() {
  return (
    <SkeletonPage
      back
      action
      titleWidth="w-64"
      subtitle
      aside={
        <>
          <Skeleton className="h-11 min-w-0 flex-1 rounded-control sm:h-9 md:w-64 md:flex-none" />
          <Skeleton className="h-11 w-11 rounded-control sm:h-9 md:w-36" />
        </>
      }
    >
      <div className="flex flex-col gap-4 lg:flex-row">
        <Skeleton className="hidden h-[60vh] w-64 shrink-0 rounded-panel lg:block" />
        <div className="min-w-0 flex-1">
          <SkeletonSheet rows={14} />
        </div>
      </div>
    </SkeletonPage>
  );
}
