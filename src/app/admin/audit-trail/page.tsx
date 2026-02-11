import { ClipboardList } from "lucide-react";
import { ComingSoonPage } from "@/components/admin/coming-soon-page";

export default function AuditTrailPage() {
  return (
    <ComingSoonPage
      title="Audit Trail"
      description="Admin action logging with who/what/when tracking. Every change to configuration, API keys, and data is recorded."
      icon={ClipboardList}
    />
  );
}
