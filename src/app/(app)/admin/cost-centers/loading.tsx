import { Card } from "@/components/ui/card";
import { SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage width="content">
      <Card>
        <SkeletonTable rows={8} columns={4} tabs />
      </Card>
    </SkeletonPage>
  );
}
