import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";

// Two lists: what needs you, then your own. No description under the greeting —
// see dashboard-client.
export default function Loading() {
  return (
    <SkeletonPage description={false} action titleWidth="w-64">
      {[0, 1].map((i) => (
        <Card key={i}>
          <div className="border-b border-border px-inset py-4">
            <Skeleton className="h-5 w-40" />
          </div>
          <SkeletonTable rows={4} columns={5} toolbar={false} />
        </Card>
      ))}
    </SkeletonPage>
  );
}
