import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Financial-term explainer. A button (not a hover-only tooltip) so it works with touch and keyboard. */
export function InfoTip({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={`About ${term}`}
        className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <Info aria-hidden="true" className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent>
        <p className="mb-1 font-semibold">{term}</p>
        <div className="text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
