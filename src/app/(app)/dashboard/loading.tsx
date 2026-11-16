import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage width="content" action titleWidth="w-40">
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="grid items-start gap-6 lg:col-span-2">
          <ListCard rows={8} />
        </div>
        <div className="grid items-start gap-6">
          {[4, 3, 3].map((rows, i) => (
            <ListCard key={i} rows={rows} />
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}

function ListCard({ rows }: { rows: number }) {
  return (
    <Card>
      <div className="border-b border-border px-inset py-4">
        <Skeleton className="h-5 w-28" />
      </div>
      <div className="space-y-3 px-inset py-4">
        {Array.from({ length: rows }, (_, r) => (
          <Skeleton key={r} className="h-4 w-full" />
        ))}
      </div>
    </Card>
  );
}
