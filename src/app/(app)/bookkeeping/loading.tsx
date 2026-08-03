import { SkeletonPage, SkeletonTableCard } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonTableCard rows={8} columns={6} tabs />
    </SkeletonPage>
  );
}
