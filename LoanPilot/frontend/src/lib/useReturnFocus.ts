import { useRef } from 'react';

/**
 * Remembers the element that had focus when a dialog opened and returns focus to it on close.
 * Radix only restores focus to a Dialog.Trigger; dialogs opened with a controlled `open` prop would
 * otherwise drop focus to <body>, losing the keyboard user's place.
 */
export function useReturnFocus(onOpenAutoFocus?: (event: Event) => void, onCloseAutoFocus?: (event: Event) => void) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    // Fires just before Radix moves focus into the dialog, so activeElement is still the opener.
    onOpenAutoFocus: (event: Event) => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      const target = opener.current;
      opener.current = null;
      if (event.defaultPrevented || !target || target === document.body || !target.isConnected) return;
      event.preventDefault();
      target.focus();
    },
  };
}
