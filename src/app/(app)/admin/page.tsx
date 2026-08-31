import { redirect } from "next/navigation";

// Settings has no landing page of its own. The sidebar lists the sections, so
// /admin just opens the first one.
export default function AdminPage() {
  redirect("/admin/fortnox");
}
