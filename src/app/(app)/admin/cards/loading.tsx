import { Card } from "@/components/ui/card";
import { SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";

// One table, its create button on the toolbar.
export default function Loading() {
  return (
    <SkeletonPage>
      <Card>
        <SkeletonTable rows={5} columns={4} tabs />
      </Card>
    </SkeletonPage>
  );
}
