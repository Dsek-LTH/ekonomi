import { Card } from "@/components/ui/card";
import { SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";

// One table of every result unit. The unit itself opens in a dialog over it.
export default function Loading() {
  return (
    <SkeletonPage>
      <Card>
        <SkeletonTable rows={7} columns={5} />
      </Card>
    </SkeletonPage>
  );
}
