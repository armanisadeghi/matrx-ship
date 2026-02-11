import { Bell } from "lucide-react";
import { ComingSoonPage } from "@/components/admin/coming-soon-page";

export default function AlertsPage() {
  return (
    <ComingSoonPage
      title="Alerts"
      description="Configure alert rules for deployment failures, error spikes, and resource thresholds. Get notified when things go wrong."
      icon={Bell}
    />
  );
}
