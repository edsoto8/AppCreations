import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatNumber } from '@/lib/format';

export const PAGE_SIZES = [25, 50, 100, 250] as const;

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  noun?: string;
}

export function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** "Rows per page" + "1–50 of 312" + first/previous/next/last. */
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, noun = 'rows' }: PaginationProps) {
  const pages = pageCount(total, pageSize);
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);
  return (
    <nav aria-label="Schedule pages" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <span id="page-size-label" className="hidden sm:inline">
          Rows per page
        </span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger size="sm" className="w-[4.75rem]" aria-labelledby="page-size-label" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-3">
        <span aria-live="polite" className="num">
          {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)} {noun}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="First page" disabled={page === 0} onClick={() => onPageChange(0)}>
            <ChevronsLeftIcon />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
            <ChevronLeftIcon />
          </Button>
          <span className="num min-w-16 text-center text-xs">
            Page {page + 1} of {pages}
          </span>
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPageChange(page + 1)}>
            <ChevronRightIcon />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Last page" disabled={page >= pages - 1} onClick={() => onPageChange(pages - 1)}>
            <ChevronsRightIcon />
          </Button>
        </div>
      </div>
    </nav>
  );
}
