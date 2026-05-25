import { redirect } from "next/navigation";

export default function RootPage() {
  // next/navigation redirect() does NOT prepend basePath, so include it
  // explicitly — otherwise /admin sends the browser to /instances (no route).
  redirect("/admin/instances");
}
