import { SkeletonCard, SkeletonFields, SkeletonPage } from "@/components/ui/skeleton";

// Connection, chart of accounts, then the booking settings.
export default function Loading() {
  return (
    <SkeletonPage titleWidth="w-40">
      <SkeletonCard action>
        <SkeletonFields fields={2} />
      </SkeletonCard>
      <SkeletonCard action />
      <SkeletonCard>
        <SkeletonFields fields={3} />
      </SkeletonCard>
    </SkeletonPage>
  );
}
