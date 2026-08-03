import { SkeletonPage, SkeletonTableCard } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage width="content">
      <SkeletonTableCard rows={6} columns={5} tabs />
    </SkeletonPage>
  );
}
