import { Construction } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { NavItem } from '@/app/navigation';

/** Honest placeholder for pages built in later milestones. */
export function PlaceholderPage({ item }: { item: NavItem }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{item.label}</h1>
        <p className="max-w-2xl text-muted-foreground">{item.description}</p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Construction aria-hidden="true" className="size-4 text-muted-foreground" />
            <CardTitle>Not built yet</CardTitle>
            <Badge variant="outline">Planned for {item.milestone}</Badge>
          </div>
          <CardDescription>
            This section is part of a later milestone. Nothing here is calculated yet, so no figures are shown.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
