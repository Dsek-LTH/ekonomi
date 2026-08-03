import {
  SkeletonCard,
  SkeletonDetailList,
  SkeletonPage,
  SkeletonSidebarLayout,
} from "@/components/ui/skeleton";

// Master–detail: the result units on the left, the selected one's owners and
// account prefixes on the right.
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonCard action />
      <SkeletonSidebarLayout items={7}>
        <div className="space-y-6">
          <SkeletonCard>
            <SkeletonDetailList rows={3} />
          </SkeletonCard>
          <SkeletonCard action />
        </div>
      </SkeletonSidebarLayout>
    </SkeletonPage>
  );
}
