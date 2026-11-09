import { Card } from "@/components/ui/card";
import { SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <Card>
        <SkeletonTable rows={7} columns={5} />
      </Card>
    </SkeletonPage>
  );
}
