import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonPage, SkeletonSheet } from "@/components/ui/skeleton";

// The report parameters stand in their own card as banded rows, then the report
// itself. Its rows are a ledger, not a list, so they get the sheet treatment.
export default function Loading() {
  return (
    <SkeletonPage action>
      <Card className="print:hidden">
        {[3, 4, 2].map((fields, row) => (
          <div
            key={row}
            className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-border px-inset py-3.5 first:border-t-0"
          >
            {Array.from({ length: fields }, (_, i) => (
              <div key={i}>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-1.5 h-11 w-32 rounded-control sm:h-9" />
              </div>
            ))}
          </div>
        ))}
      </Card>
      <SkeletonSheet rows={14} columns={5} />
    </SkeletonPage>
  );
}
