/** Static inline SVG icons (24×24, stroke-based). Trusted markup, never user content. */
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  power: svg('<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  front: svg('<rect x="6" y="2.5" width="12" height="19" rx="2"/><rect x="8.5" y="5" width="7" height="6" rx="0.8"/><path d="M9 15.5h2M10 14.5v2"/><circle cx="15" cy="15.5" r="0.9"/>'),
  back: svg('<rect x="6" y="2.5" width="12" height="19" rx="2"/><rect x="8" y="12" width="8" height="7.5" rx="1"/><path d="M8.5 3v5.5h7V3"/>'),
  cartridge: svg('<path d="M6 3h10l2 2v16H6z"/><rect x="8.5" y="8" width="7" height="7" rx="0.6"/><path d="M8 18.5h8"/>'),
  screen: svg('<path d="M3 8V4h4M21 8V4h-4M3 16v4h4M21 16v4h-4"/><rect x="7.5" y="8" width="9" height="8" rx="1"/>'),
  explode: svg('<rect x="9" y="9" width="6" height="6" rx="1"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M19 5l-2.5 2.5M5 19l2.5-2.5M19 19l-2.5-2.5"/>'),
  xray: svg('<rect x="6" y="2.5" width="12" height="19" rx="2" stroke-dasharray="2.5 2"/><rect x="9" y="7" width="6" height="5" rx="0.6"/><path d="M9 16h6"/>'),
  light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  display: svg('<rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/><path d="M7 8h2v2H7zM11 10h2v2h-2zM15 8h2v2h-2z" fill="currentColor" stroke="none"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 1-1 1.7v.5"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/>'),
  sound: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  mute: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  focus: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
} as const;

export type IconName = keyof typeof ICONS;
