import { Skeleton, SkeletonPage, SkeletonSheet } from "@/components/ui/skeleton";

// The heaviest page in the app (a whole budget with every cost centre, its
// variables and its changes) so it is the one where the wait is most worth
// drawing. It opens on the detail view: the header (the way back, the title
// with the antagen date beside it, and the menu at its far end, see the page's
// `aside`), the toolbar (the view switch, the comparison and the lock), then
// the list of cost centres beside the first one's sheet, from lg, where the
// page puts them side by side.
export default function Loading() {
  return (
    <SkeletonPage
      back
      titleWidth="w-96 max-w-full"
      aside={<Skeleton className="size-8 rounded-control" />}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-8 w-64 rounded-control" />
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <Skeleton className="h-8 min-w-0 flex-1 rounded-control md:w-64 md:flex-none" />
          <Skeleton className="h-8 w-8 rounded-control md:w-24" />
        </div>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row">
        <Skeleton className="hidden h-[60vh] w-64 shrink-0 rounded-panel lg:block" />
        <div className="min-w-0 flex-1">
          <SkeletonSheet rows={14} />
        </div>
      </div>
    </SkeletonPage>
  );
}
