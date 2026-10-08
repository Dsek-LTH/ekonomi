import { Card } from "@/components/ui/card";
import { SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";

// No card header: the create button rides the table's own toolbar.
export default function Loading() {
  return (
    <SkeletonPage width="content">
      <Card>
        <SkeletonTable rows={8} columns={4} tabs />
      </Card>
    </SkeletonPage>
  );
}
