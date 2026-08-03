import { Card, CardBody } from "@/components/ui/card";
import { Skeleton, SkeletonFields, SkeletonPage } from "@/components/ui/skeleton";

// The wizard: a stepper, then one card of fields at a time.
export default function Loading() {
  return (
    <SkeletonPage width="content" back titleWidth="w-48">
      <div className="flex items-center gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-1 items-center gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-24" />
            {i < 2 && <Skeleton className="h-px flex-1" />}
          </div>
        ))}
      </div>
      <Card>
        <CardBody>
          <SkeletonFields fields={4} />
        </CardBody>
      </Card>
    </SkeletonPage>
  );
}
