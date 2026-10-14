import { CarFrontIcon, ChevronsUpDownIcon, PlusIcon } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useLoanContext } from '@/context/LoanContext';
import { useCurrency } from '@/context/PreferencesContext';
import { formatCurrency } from '@/lib/format';

/** Top-bar dropdown: pick the active loan or start a new one. */
export function LoanSelector() {
  const { loans, isLoading, selectedLoan, setSelectedLoanId } = useLoanContext();
  const currency = useCurrency();
  const navigate = useNavigate();

  if (isLoading) return <Skeleton className="h-9 w-44" />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 max-w-[16rem] min-w-0 justify-between gap-2 px-3" aria-label="Select loan">
          <CarFrontIcon className="text-muted-foreground" aria-hidden />
          <span className="truncate">{selectedLoan ? selectedLoan.loan.name : loans.length ? 'Select a loan' : 'No loans yet'}</span>
          <ChevronsUpDownIcon className="ml-auto text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {loans.length > 0 && (
          <>
            <DropdownMenuLabel>Your loans</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={selectedLoan ? String(selectedLoan.loan.id) : ''}
              onValueChange={(v) => setSelectedLoanId(Number(v))}
            >
              {loans.map((item) => (
                <DropdownMenuRadioItem key={item.loan.id} value={String(item.loan.id)} className="items-start py-2">
                  <div className="grid min-w-0 gap-0.5">
                    <span className="truncate font-medium">{item.loan.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.isPaidOff ? 'Paid off' : `${formatCurrency(item.currentBalance, currency)} remaining`}
                    </span>
                  </div>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => navigate('/loans/new')}>
          <PlusIcon aria-hidden /> New loan
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
