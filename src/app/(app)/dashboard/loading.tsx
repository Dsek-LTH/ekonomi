import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage width="content" action titleWidth="w-40">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="space-y-2 px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-10" />
            <Skeleton className="h-3 w-24" />
          </Card>
        ))}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="grid items-start gap-6 lg:col-span-2">
          {[5, 3].map((rows, i) => (
            <ListCard key={i} rows={rows} />
          ))}
        </div>
        <div className="grid items-start gap-6">
          {[3, 4].map((rows, i) => (
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
