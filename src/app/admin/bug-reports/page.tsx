import { Bug } from "lucide-react";
import { ComingSoonPage } from "@/components/admin/coming-soon-page";

export default function BugReportsPage() {
  return (
    <ComingSoonPage
      title="Bug Reports"
      description="Track, triage, and resolve bugs reported by users and automated systems. Integrates with the Matrx Feedback pipeline."
      icon={Bug}
    />
  );
}
