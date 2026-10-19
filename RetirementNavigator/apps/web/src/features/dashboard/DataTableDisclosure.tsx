import { useId, useState } from 'react';
import { ChevronDown, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * A keyboard-reachable button that reveals a chart's data table (the accessible alternative with
 * the same series and units). Content mounts only while open, so long tables cost nothing hidden.
 */
export function DataTableDisclosure({
  label,
  children,
  defaultOpen = false,
}: {
  /** What the table shows, e.g. "Portfolio value data table". */
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          <Table2 aria-hidden="true" />
          {open ? 'Hide' : 'Show'} {label}
          <ChevronDown aria-hidden="true" className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
      </div>
      <div id={id} hidden={!open}>
        {open ? children : null}
      </div>
    </div>
  );
}
