import { useState } from 'react';
import { InfoIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { glossary, type GlossaryKey } from '@/lib/glossary';
import { cn } from '@/lib/utils';

interface FieldInfoProps {
  term: GlossaryKey;
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/** ⓘ button explaining a financial term. Opens on hover, keyboard focus, or tap (touch). */
export function FieldInfo({ term, className, side = 'top' }: FieldInfoProps) {
  const entry = glossary[term];
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`What is ${entry.term}?`}
          className={cn(
            'inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            className,
          )}
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            setOpen((o) => !o);
          }}
        >
          <InfoIcon className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="text-left">
        <p className="mb-0.5 font-semibold">{entry.term}</p>
        <p className="opacity-90">{entry.definition}</p>
      </TooltipContent>
    </Tooltip>
  );
}
