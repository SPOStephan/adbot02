import { redirect } from "next/navigation";

/** Legacy admin URL — Branding lives at /dashboard/branding. */
export default function DashboardLogoRedirect() {
  redirect("/dashboard/branding");
}
