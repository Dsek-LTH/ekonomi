import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton";

// The invoice as it will land: status with the actions opposite, the ruled
// strip of amount, date and payment type, the line items, and the small print
// at the foot. The header above it is identity only (title, then reference and
// submitter), so it has no action slot to hold.
export default function Loading() {
  return (
    <SkeletonPage width="content" back description={false} titleWidth="w-72">
      <Card>
        <div className="flex items-start justify-between gap-6 px-inset py-4">
          <Skeleton className="mt-1.5 h-6 w-28 rounded-control" />
          <Skeleton className="h-9 w-32 rounded-control" />
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`space-y-1.5 bg-background px-inset py-3 ${i === 0 ? "col-span-2 sm:col-span-1" : ""}`}
            >
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
        <div className="space-y-3 border-t border-border px-inset py-4">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="space-y-2 rounded-b-panel border-t border-border bg-canvas px-inset py-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </Card>
    </SkeletonPage>
  );
}
