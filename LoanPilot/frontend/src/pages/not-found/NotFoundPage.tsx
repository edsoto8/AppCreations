import { Link } from 'react-router';
import { CompassIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<CompassIcon />}
      title="This page does not exist"
      description="The link may be out of date. Head back to your dashboard to continue."
      action={
        <Button asChild>
          <Link to="/">Go to dashboard</Link>
        </Button>
      }
    />
  );
}
