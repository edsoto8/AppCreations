import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router';
import type { UnverifiedDetail } from '@rn/engine';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

/** Inline badge for a single output that depends on an unverified rule value. */
export function UnverifiedValue({ label = 'Unverified rule' }: { label?: string }) {
  return (
    <Badge variant="attention" title="This figure needs a regulatory value that has not been verified at source.">
      <ShieldAlert aria-hidden="true" className="size-3" />
      {label}
    </Badge>
  );
}

/** Explains why a feature is disabled: which rule values are unverified. */
export function UnverifiedNotice({ missing, feature }: { missing: readonly UnverifiedDetail[]; feature: string }) {
  if (missing.length === 0) return null;
  return (
    <Alert variant="attention">
      <ShieldAlert aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{feature} is unavailable: rule values are unverified</p>
        <p className="text-muted-foreground">
          This needs {missing.length} regulatory value{missing.length === 1 ? '' : 's'} that could not be verified
          against an official source yet (
          {missing
            .slice(0, 3)
            .map((m) => m.key.split(':')[1])
            .join(', ')}
          {missing.length > 3 ? ', …' : ''}). The app never fills in unverified values.{' '}
          <Link to="/rules" className="font-medium text-foreground underline underline-offset-4">
            See Rules &amp; Sources
          </Link>
          .
        </p>
      </div>
    </Alert>
  );
}
