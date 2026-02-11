import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/admin/page-shell";

interface ComingSoonPageProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function ComingSoonPage({ title, description, icon: Icon }: ComingSoonPageProps) {
  return (
    <PageShell title={title} description="Coming soon">
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Icon className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">{title}</h2>
          <p className="text-muted-foreground mb-6">{description}</p>
          <Badge variant="secondary" className="text-sm px-4 py-1.5">
            Coming Soon
          </Badge>
        </div>
      </div>
    </PageShell>
  );
}
