import { redirect } from "next/navigation";

export default function RootPage() {
  // redirect() prepends basePath (/admin), so pass the in-app path only —
  // passing "/admin/instances" here produced /admin/admin/instances.
  redirect("/servers");
}
