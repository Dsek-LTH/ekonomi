import { Card, CardBody } from "@/components/ui/card";
import {
  SkeletonCard,
  SkeletonDetailList,
  SkeletonFields,
  SkeletonPage,
} from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage width="content">
      <Card>
        <CardBody>
          <SkeletonDetailList rows={3} />
        </CardBody>
      </Card>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <SkeletonCard action>
          <SkeletonFields fields={2} />
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonDetailList rows={2} />
        </SkeletonCard>
      </div>
    </SkeletonPage>
  );
}
