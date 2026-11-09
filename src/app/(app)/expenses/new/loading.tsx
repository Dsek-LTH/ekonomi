import { Card, CardBody } from "@/components/ui/card";
import { SkeletonFields, SkeletonPage } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonPage width="content" back titleWidth="w-48">
      <Card>
        <CardBody>
          <SkeletonFields fields={5} />
        </CardBody>
      </Card>
    </SkeletonPage>
  );
}
