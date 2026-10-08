import { Card } from "@/components/ui/card";
import { SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";

// One table of the role holders, the member search on its toolbar.
export default function Loading() {
  return (
    <SkeletonPage>
      <Card>
        <SkeletonTable rows={8} columns={2} />
      </Card>
    </SkeletonPage>
  );
}
