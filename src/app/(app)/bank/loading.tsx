import { Card } from "@/components/ui/card";
import { SkeletonTable, SkeletonPage } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <Card>
        <SkeletonTable rows={8} columns={6} tabs />
      </Card>
    </SkeletonPage>
  );
}
