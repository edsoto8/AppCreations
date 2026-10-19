import { Receipt, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/** On figures that use contributions as elected because plan/IRA/HSA limits are unverified (docs §1.7). */
export function BeforeLimitsBadge() {
  return (
    <Badge variant="attention">
      <ShieldAlert aria-hidden="true" className="size-3" />
      Before plan limits (unverified)
    </Badge>
  );
}

/** On retirement income figures while retirement-phase taxes are not modeled (M4). */
export function BeforeTaxesBadge() {
  return (
    <Badge variant="outline">
      <Receipt aria-hidden="true" className="size-3" />
      Before taxes
    </Badge>
  );
}
