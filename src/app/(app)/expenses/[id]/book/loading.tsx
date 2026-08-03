import { Card, CardBody } from "@/components/ui/card";
import { Skeleton, SkeletonPage, SkeletonTable } from "@/components/ui/skeleton";

// Booking: the voucher head in a card, then the lines as a table.
export default function Loading() {
  return (
    <SkeletonPage back titleWidth="w-64">
      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="mt-1.5 h-10 w-full rounded-xl" />
            </div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <div className="border-b border-border px-inset py-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-1.5 h-3.5 w-64" />
        </div>
        <SkeletonTable rows={4} columns={5} toolbar={false} />
      </Card>
    </SkeletonPage>
  );
}
