import { SkeletonCard, SkeletonFields, SkeletonPage } from "@/components/ui/skeleton";

// Connection, the booking settings, then the sync rows.
export default function Loading() {
  return (
    <SkeletonPage titleWidth="w-40">
      <SkeletonCard action>
        <SkeletonFields fields={1} />
      </SkeletonCard>
      <SkeletonCard>
        <SkeletonFields fields={3} />
      </SkeletonCard>
      <SkeletonCard>
        <SkeletonFields fields={2} />
      </SkeletonCard>
    </SkeletonPage>
  );
}
