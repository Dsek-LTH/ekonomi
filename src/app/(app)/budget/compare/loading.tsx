import { SkeletonPage, SkeletonSheet } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage width="content" back action>
      <SkeletonSheet rows={10} columns={4} />
    </SkeletonPage>
  );
}
