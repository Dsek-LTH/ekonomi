import { Card } from "@/components/ui/card";
import { SkeletonTable, SkeletonPage } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      {/* No card header: the import control rides the table's own toolbar. */}
      <Card>
        <SkeletonTable rows={8} columns={6} tabs />
      </Card>
    </SkeletonPage>
  );
}
