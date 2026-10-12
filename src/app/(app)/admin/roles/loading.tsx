import { Card } from "@/components/ui/card";
import { SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";

// The Grupper view, which is the one the page opens on: one table of groups.
export default function Loading() {
  return (
    <SkeletonPage>
      <Card>
        <SkeletonTable rows={8} columns={5} tabs />
      </Card>
    </SkeletonPage>
  );
}
