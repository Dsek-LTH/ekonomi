import { Card, CardBody } from "@/components/ui/card";
import {
  SkeletonCard,
  SkeletonDetailList,
  SkeletonFields,
  SkeletonPage,
} from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage width="form">
      <Card>
        <CardBody>
          <SkeletonDetailList rows={3} />
        </CardBody>
      </Card>
      {/* Payout account, then the Fortnox controls for those who get them. */}
      <SkeletonCard action>
        <SkeletonFields fields={2} />
      </SkeletonCard>
    </SkeletonPage>
  );
}
