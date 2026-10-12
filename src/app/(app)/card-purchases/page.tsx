import { permanentRedirect } from "next/navigation";

// Kortköp is Bankhändelser scoped to you.
//
// The two were the same query drawn twice, see (app)/bank/page.tsx, which now
// answers both readings. Kept as a redirect rather than deleted: this route is
// in people's history and in links they have sent each other, and a 404 is a
// worse answer than the page they meant.
export default function CardPurchasesPage() {
  permanentRedirect("/bank?scope=mine");
}
