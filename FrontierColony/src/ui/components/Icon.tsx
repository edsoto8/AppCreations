import type { ReactNode, SVGProps } from 'react';

/**
 * Hand-drawn inline SVG icons (24x24). Resource, weather and season icons are two-tone and use the
 * colour tokens from styles/tokens.css; UI glyphs use `currentColor`.
 */
export type IconName =
  | 'wood'
  | 'stone'
  | 'food'
  | 'water'
  | 'tools'
  | 'housing'
  | 'people'
  | 'sun'
  | 'moon'
  | 'sunrise'
  | 'sunset'
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'storm'
  | 'snow'
  | 'spring'
  | 'summer'
  | 'autumn'
  | 'winter'
  | 'pause'
  | 'play1'
  | 'play2'
  | 'play4'
  | 'build'
  | 'settlers'
  | 'priorities'
  | 'events'
  | 'save'
  | 'settings'
  | 'close'
  | 'dice'
  | 'trash'
  | 'check'
  | 'info'
  | 'warning'
  | 'danger'
  | 'good'
  | 'chevron'
  | 'folder'
  | 'home'
  | 'flag'
  | 'back'
  | 'compass'
  | 'lock'
  | 'heart'
  | 'bolt'
  | 'smile'
  | 'arrowUp'
  | 'arrowDown'
  | 'crosshair'
  | 'hammer'
  | 'clock'
  | 'cart'
  | 'trophy'
  | 'chart'
  | 'moodInspired'
  | 'moodContent'
  | 'moodUnhappy'
  | 'moodMiserable'
  | 'moodBreaking';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const cloud = (fill = '#cdd5dd') => (
  <path d="M7 17a4 4 0 0 1-.4-7.98A5.5 5.5 0 0 1 17.2 8.6 4.2 4.2 0 0 1 17 17Z" fill={fill} stroke="#7d8793" strokeWidth="1.2" strokeLinejoin="round" />
);

const GLYPHS: Record<IconName, ReactNode> = {
  wood: (
    <>
      <circle cx="7.5" cy="16.5" r="4.6" fill="var(--c-wood)" stroke="var(--c-wood-dark)" strokeWidth="1.3" />
      <circle cx="16.5" cy="16.5" r="4.6" fill="var(--c-wood)" stroke="var(--c-wood-dark)" strokeWidth="1.3" />
      <circle cx="12" cy="8.6" r="4.6" fill="#cf9a62" stroke="var(--c-wood-dark)" strokeWidth="1.3" />
      <circle cx="12" cy="8.6" r="2.2" fill="none" stroke="var(--c-wood-dark)" strokeWidth="1" />
      <circle cx="7.5" cy="16.5" r="2.2" fill="none" stroke="var(--c-wood-dark)" strokeWidth="1" />
      <circle cx="16.5" cy="16.5" r="2.2" fill="none" stroke="var(--c-wood-dark)" strokeWidth="1" />
    </>
  ),
  stone: (
    <>
      <path d="M2.8 17.2 6.6 8.4 12.6 5l6.2 3.6 2.4 8.6-8.6 3.4Z" fill="var(--c-stone)" stroke="var(--c-stone-dark)" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6.6 8.4 12.2 11l6.6-2.4M12.2 11l.4 9.6M2.8 17.2l9.4-6.2 9 6.2" fill="none" stroke="var(--c-stone-dark)" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M6.6 8.4 12.6 5l-.4 6Z" fill="#cfd3d6" opacity=".7" />
    </>
  ),
  food: (
    <>
      <path d="M12 22V8" stroke="var(--c-food-dark)" strokeWidth="1.8" strokeLinecap="round" />
      <g fill="var(--c-food)" stroke="var(--c-food-dark)" strokeWidth="1.1">
        <ellipse cx="12" cy="4.6" rx="1.8" ry="2.8" />
        <ellipse cx="8.6" cy="8.2" rx="1.8" ry="3" transform="rotate(-38 8.6 8.2)" />
        <ellipse cx="15.4" cy="8.2" rx="1.8" ry="3" transform="rotate(38 15.4 8.2)" />
        <ellipse cx="8.8" cy="13.2" rx="1.8" ry="3" transform="rotate(-38 8.8 13.2)" />
        <ellipse cx="15.2" cy="13.2" rx="1.8" ry="3" transform="rotate(38 15.2 13.2)" />
      </g>
    </>
  ),
  water: (
    <>
      <path d="M12 2.6c-3 4.2-6.6 8-6.6 12a6.6 6.6 0 0 0 13.2 0c0-4-3.6-7.8-6.6-12Z" fill="var(--c-water)" stroke="var(--c-water-dark)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8.6 15.2a3.6 3.6 0 0 0 2.6 3.2" fill="none" stroke="#e8f6ff" strokeWidth="1.5" strokeLinecap="round" opacity=".9" />
    </>
  ),
  tools: (
    <>
      <path d="m4.6 20.4 10-10" stroke="var(--c-wood-dark)" strokeWidth="3" strokeLinecap="round" />
      <path d="m4.6 20.4 10-10" stroke="var(--c-wood)" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="10.6" y="3.6" width="10.4" height="5.4" rx="1.2" transform="rotate(45 15.8 6.3)" fill="var(--c-tools)" stroke="var(--c-tools-dark)" strokeWidth="1.3" />
    </>
  ),
  housing: (
    <>
      <path d="M4.6 11.2V20h14.8v-8.8" fill="var(--c-housing)" stroke="#8c4527" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M2.4 12.2 12 3.8l9.6 8.4" fill="#b84f2e" stroke="#7d3219" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <rect x="10" y="14" width="4" height="6" rx=".8" fill="#5e3320" />
    </>
  ),
  people: (
    <>
      <circle cx="8.6" cy="8" r="3.2" fill="var(--c-people)" stroke="#8f6a3a" strokeWidth="1.3" />
      <path d="M2.6 20c0-3.6 2.6-6 6-6s6 2.4 6 6Z" fill="var(--c-people)" stroke="#8f6a3a" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="16.6" cy="8.8" r="2.6" fill="#c9a06a" stroke="#8f6a3a" strokeWidth="1.2" />
      <path d="M15.4 14.2c3.4-.4 6 1.6 6 5.8h-5.2" fill="#c9a06a" stroke="#8f6a3a" strokeWidth="1.2" strokeLinejoin="round" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.6" fill="#ffd45a" stroke="#d99a1e" strokeWidth="1.3" />
      <g stroke="#f2b13a" strokeWidth="1.8" strokeLinecap="round">
        <path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M5.2 18.8l1.7-1.7M17.1 6.9l1.7-1.7" />
      </g>
    </>
  ),
  moon: <path d="M20 14.6A8.4 8.4 0 0 1 9.4 4a8.6 8.6 0 1 0 10.6 10.6Z" fill="#e7e2c8" stroke="#a9a487" strokeWidth="1.3" strokeLinejoin="round" />,
  sunrise: (
    <>
      <path d="M5 17a7 7 0 0 1 14 0Z" fill="#ffd45a" stroke="#d99a1e" strokeWidth="1.3" />
      <path d="M2 20h20M12 4v3M4.4 8.4l1.8 1.8M19.6 8.4l-1.8 1.8" stroke="#f2b13a" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  sunset: (
    <>
      <path d="M5 17a7 7 0 0 1 14 0Z" fill="#ff9a5a" stroke="#c9602a" strokeWidth="1.3" />
      <path d="M2 20h20M12 4v3M4.4 8.4l1.8 1.8M19.6 8.4l-1.8 1.8" stroke="#e8793a" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  clear: (
    <>
      <circle cx="12" cy="12" r="4.6" fill="#ffd45a" stroke="#d99a1e" strokeWidth="1.3" />
      <g stroke="#f2b13a" strokeWidth="1.8" strokeLinecap="round">
        <path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M5.2 18.8l1.7-1.7M17.1 6.9l1.7-1.7" />
      </g>
    </>
  ),
  cloudy: (
    <>
      <circle cx="16.8" cy="7.2" r="3" fill="#ffd45a" stroke="#d99a1e" strokeWidth="1.1" />
      <g transform="translate(-1 2)">{cloud()}</g>
    </>
  ),
  rain: (
    <>
      <g transform="translate(0 -2)">{cloud('#aab6c2')}</g>
      <g stroke="var(--c-water)" strokeWidth="2" strokeLinecap="round">
        <path d="M8 18.4 7 21M12.4 18.4l-1 2.6M16.8 18.4l-1 2.6" />
      </g>
    </>
  ),
  storm: (
    <>
      <g transform="translate(0 -2.4)">{cloud('#8b96a3')}</g>
      <path d="m12.8 13.6-3 4.4h2.6l-1.2 4 4.4-5.6h-2.8l1.2-2.8Z" fill="#ffd45a" stroke="#d99a1e" strokeWidth="1" strokeLinejoin="round" />
    </>
  ),
  snow: (
    <>
      <g transform="translate(0 -2.4)">{cloud('#d8dfe6')}</g>
      <g fill="#f4fbff" stroke="#8fb4cc" strokeWidth=".8">
        <circle cx="8" cy="19" r="1.3" />
        <circle cx="12.4" cy="20.6" r="1.3" />
        <circle cx="16.6" cy="19" r="1.3" />
      </g>
    </>
  ),
  spring: (
    <>
      <path d="M12 21v-9" stroke="#5f9a45" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 13c0-4.4-3-6.4-7.4-6 0 4.4 3 6.6 7.4 6Z" fill="#8bcf70" stroke="#4f8a38" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M12 11.6c0-3.8 2.8-5.8 7.2-5.4 0 3.8-2.8 5.8-7.2 5.4Z" fill="#a8dd8a" stroke="#4f8a38" strokeWidth="1.2" strokeLinejoin="round" />
    </>
  ),
  summer: (
    <>
      <circle cx="12" cy="12" r="4.6" fill="#ffd45a" stroke="#d99a1e" strokeWidth="1.3" />
      <g stroke="#f2b13a" strokeWidth="1.8" strokeLinecap="round">
        <path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M5.2 18.8l1.7-1.7M17.1 6.9l1.7-1.7" />
      </g>
    </>
  ),
  autumn: (
    <>
      <path d="M12 21.4V12" stroke="#8a4a22" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 3c4 2.4 7.4 5.6 6.6 10.2-1 .4-2.4.2-3.4-.6.4 2.6-.6 4.4-3.2 5.4-2.6-1-3.6-2.8-3.2-5.4-1 .8-2.4 1-3.4.6C4.6 8.6 8 5.4 12 3Z" fill="#e0822f" stroke="#a6501a" strokeWidth="1.2" strokeLinejoin="round" />
    </>
  ),
  winter: (
    <g stroke="#bfe3f7" strokeWidth="1.8" strokeLinecap="round" fill="none">
      <path d="M12 2.6v18.8M3.9 7.3l16.2 9.4M3.9 16.7l16.2-9.4" />
      <path d="m9.6 4.4 2.4 2.2 2.4-2.2M9.6 19.6l2.4-2.2 2.4 2.2M3.6 10.4l3.2-.6-.6-3.2M20.4 13.6l-3.2.6.6 3.2M3.6 13.6l3.2.6-.6 3.2M20.4 10.4l-3.2-.6.6-3.2" strokeWidth="1.3" />
    </g>
  ),
  pause: (
    <>
      <rect x="6" y="4.6" width="4.2" height="14.8" rx="1.2" fill="currentColor" />
      <rect x="13.8" y="4.6" width="4.2" height="14.8" rx="1.2" fill="currentColor" />
    </>
  ),
  play1: <path d="M8 5.6v12.8l10.4-6.4Z" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
  play2: (
    <g fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M4 6.4v11.2l7.6-5.6Z" />
      <path d="M12.4 6.4v11.2L20 12Z" />
    </g>
  ),
  play4: (
    <g fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M1.8 7v10l6.2-5Z" />
      <path d="M8.9 7v10l6.2-5Z" />
      <path d="M16 7v10l6.2-5Z" />
    </g>
  ),
  build: (
    <g {...stroke}>
      <path d="m3.4 20.6 9.4-9.4" strokeWidth="2.6" />
      <path d="M12.6 5.4 15 3l5.6 5.6-2.4 2.4-1.4-1.4-1.6 1.6-3-3 1.6-1.6Z" fill="currentColor" fillOpacity=".25" />
    </g>
  ),
  settlers: (
    <g {...stroke}>
      <circle cx="9" cy="7.6" r="3.2" />
      <path d="M2.8 20c0-3.8 2.8-6.2 6.2-6.2s6.2 2.4 6.2 6.2Z" />
      <path d="M16 4.8a3 3 0 0 1 0 5.6M18.4 14.4c1.8.8 2.8 2.6 2.8 5.6" />
    </g>
  ),
  priorities: (
    <g {...stroke}>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2" fill="var(--bg-deep)" />
      <circle cx="15" cy="12" r="2" fill="var(--bg-deep)" />
      <circle cx="8" cy="17" r="2" fill="var(--bg-deep)" />
    </g>
  ),
  events: (
    <g {...stroke}>
      <path d="M6 3.6h10.4a2.4 2.4 0 0 1 2.4 2.4v13.4H8.4A2.4 2.4 0 0 1 6 17Z" />
      <path d="M6 17V6a2.4 2.4 0 0 0-2.4 2.4v1.2H6M10 8.4h6M10 12h6M10 15.6h3" />
    </g>
  ),
  save: (
    <g {...stroke}>
      <path d="M4.6 4.6h12l2.8 2.8v12H4.6Z" />
      <path d="M8 4.6v5h7v-5M7.6 19.4v-6h8.8v6" />
    </g>
  ),
  settings: (
    <g {...stroke}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" />
    </g>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" {...stroke} strokeWidth={2.2} />,
  dice: (
    <g {...stroke} strokeWidth={1.8}>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.6" />
      <g fill="currentColor" stroke="none">
        <circle cx="8.4" cy="8.4" r="1.4" />
        <circle cx="15.6" cy="8.4" r="1.4" />
        <circle cx="12" cy="12" r="1.4" />
        <circle cx="8.4" cy="15.6" r="1.4" />
        <circle cx="15.6" cy="15.6" r="1.4" />
      </g>
    </g>
  ),
  trash: (
    <g {...stroke} strokeWidth={1.9}>
      <path d="M4 6.6h16M9.4 6.6V4h5.2v2.6M6.2 6.6l.8 13.4h10l.8-13.4M10 10.6v6M14 10.6v6" />
    </g>
  ),
  check: <path d="m5 12.6 4.4 4.4L19 7.4" {...stroke} strokeWidth={2.6} />,
  info: (
    <g {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.4M12 7.6v.2" strokeWidth="2.4" />
    </g>
  ),
  warning: (
    <g {...stroke}>
      <path d="M12 3.6 21.6 20H2.4Z" />
      <path d="M12 10v4.6M12 17.4v.2" strokeWidth="2.4" />
    </g>
  ),
  danger: (
    <g {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.6 8.6 6.8 6.8M15.4 8.6l-6.8 6.8" />
    </g>
  ),
  good: (
    <g {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="m7.8 12.4 3 3 5.6-6.2" />
    </g>
  ),
  chevron: <path d="m9 5 7 7-7 7" {...stroke} strokeWidth={2.4} />,
  folder: (
    <g {...stroke}>
      <path d="M3 18.4V6.6a1.6 1.6 0 0 1 1.6-1.6h4.4l2 2.4h8.4A1.6 1.6 0 0 1 21 9v9.4a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 18.4Z" />
    </g>
  ),
  home: (
    <g {...stroke}>
      <path d="M3.6 11.4 12 4l8.4 7.4M5.8 9.8V20h12.4V9.8M10 20v-5.6h4V20" />
    </g>
  ),
  flag: (
    <g {...stroke}>
      <path d="M5.6 21V3.6M5.6 4.6h12l-2.4 4 2.4 4h-12" />
    </g>
  ),
  back: <path d="m15 5-7 7 7 7" {...stroke} strokeWidth={2.4} />,
  compass: (
    <g {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.6 8.4-2 5.2-5.2 2 2-5.2Z" fill="currentColor" fillOpacity=".3" />
    </g>
  ),
  heart: <path d="M12 20.4S3.4 15 3.4 9.2A4.6 4.6 0 0 1 12 7.4a4.6 4.6 0 0 1 8.6 1.8C20.6 15 12 20.4 12 20.4Z" fill="#e5604f" stroke="#8c2a20" strokeWidth="1.3" strokeLinejoin="round" />,
  bolt: <path d="M13.4 2.8 5.6 13.4h5.2l-1.2 7.8 8.8-11.4h-5.4Z" fill="#f4d35a" stroke="#a8841a" strokeWidth="1.2" strokeLinejoin="round" />,
  smile: (
    <g fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9.2" fill="#f2c14e" stroke="rgba(0,0,0,.45)" strokeWidth="1.2" />
      <circle cx="9" cy="10" r="1.1" fill="#2a1d10" stroke="none" />
      <circle cx="15" cy="10" r="1.1" fill="#2a1d10" stroke="none" />
      <path d="M8.2 14.2c1.8 2.2 5.8 2.2 7.6 0" stroke="#2a1d10" />
    </g>
  ),
  arrowUp: <path d="M12 19V6M6.4 11.4 12 5.8l5.6 5.6" {...stroke} strokeWidth={2.4} />,
  arrowDown: <path d="M12 5v13M6.4 12.6 12 18.2l5.6-5.6" {...stroke} strokeWidth={2.4} />,
  crosshair: (
    <g {...stroke} strokeWidth={1.9}>
      <circle cx="12" cy="12" r="6.6" />
      <path d="M12 2.6v4.4M12 17v4.4M2.6 12H7M17 12h4.4" />
    </g>
  ),
  hammer: (
    <>
      <path d="m4.6 20.4 10-10" stroke="var(--c-wood-dark)" strokeWidth="3" strokeLinecap="round" />
      <rect x="10.6" y="3.6" width="10.4" height="5.4" rx="1.2" transform="rotate(45 15.8 6.3)" fill="var(--c-tools)" stroke="var(--c-tools-dark)" strokeWidth="1.3" />
    </>
  ),
  clock: (
    <g {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6.6V12l3.6 2.2" />
    </g>
  ),
  moodInspired: (
    <g fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9.2" fill="#8bcf70" stroke="rgba(0,0,0,.45)" strokeWidth="1.2" />
      <circle cx="9" cy="10" r="1.1" fill="#2a1d10" stroke="none" />
      <circle cx="15" cy="10" r="1.1" fill="#2a1d10" stroke="none" />
      <path d="M7.6 13.6c1.8 3.2 7 3.2 8.8 0Z" stroke="#2a1d10" />
      <path d="m5.2 4.6 1 2M18.8 4.6l-1 2M12 2.4v2" stroke="#f4d35a" strokeWidth="1.5" />
    </g>
  ),
  moodContent: (
    <g fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9.2" fill="#b8d46a" stroke="rgba(0,0,0,.45)" strokeWidth="1.2" />
      <circle cx="9" cy="10" r="1.1" fill="#2a1d10" stroke="none" />
      <circle cx="15" cy="10" r="1.1" fill="#2a1d10" stroke="none" />
      <path d="M8.4 14.2c1.6 1.6 5.6 1.6 7.2 0" stroke="#2a1d10" />
    </g>
  ),
  moodUnhappy: (
    <g fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9.2" fill="#f0c050" stroke="rgba(0,0,0,.45)" strokeWidth="1.2" />
      <circle cx="9" cy="10" r="1.1" fill="#2a1d10" stroke="none" />
      <circle cx="15" cy="10" r="1.1" fill="#2a1d10" stroke="none" />
      <path d="M8.6 15.8h6.8" stroke="#2a1d10" />
    </g>
  ),
  moodMiserable: (
    <g fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9.2" fill="#ee9b4a" stroke="rgba(0,0,0,.45)" strokeWidth="1.2" />
      <circle cx="9" cy="10" r="1.1" fill="#2a1d10" stroke="none" />
      <circle cx="15" cy="10" r="1.1" fill="#2a1d10" stroke="none" />
      <path d="M8.4 16.6c1.6-1.8 5.6-1.8 7.2 0" stroke="#2a1d10" />
    </g>
  ),
  moodBreaking: (
    <g fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9.2" fill="#e5604f" stroke="rgba(0,0,0,.45)" strokeWidth="1.2" />
      <circle cx="9" cy="10" r="1.1" fill="#2a1d10" stroke="none" />
      <circle cx="15" cy="10" r="1.1" fill="#2a1d10" stroke="none" />
      <path d="M8 17c1.6-2.4 6.4-2.4 8 0" stroke="#2a1d10" />
      <path d="M7.2 7.6l3 1M16.8 7.6l-3 1" stroke="#2a1d10" />
    </g>
  ),
  cart: (
    <g {...stroke} strokeWidth={1.9}>
      <path d="M3 5h3l2.2 10.4h9.4L20 8.4H7" />
      <circle cx="9.6" cy="19" r="1.6" fill="currentColor" />
      <circle cx="16.4" cy="19" r="1.6" fill="currentColor" />
    </g>
  ),
  trophy: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.4 4h9.2v5.2a4.6 4.6 0 0 1-9.2 0Z" fill="#f4c64e" stroke="#a8841a" strokeWidth="1.3" />
      <path d="M7.4 6H4.4c0 3 1.4 4.6 3.4 4.8M16.6 6h3c0 3-1.4 4.6-3.4 4.8" fill="none" stroke="#a8841a" strokeWidth="1.5" />
      <path d="M12 13.8V17M8.4 20.4h7.2M9.6 17h4.8l.6 3.4H9Z" fill="#d9a53a" stroke="#a8841a" strokeWidth="1.3" />
    </g>
  ),
  chart: (
    <g {...stroke} strokeWidth={1.9}>
      <path d="M4 4v16h16" />
      <path d="m7.6 15 3.4-4.6 3 2.8 4.4-6" />
    </g>
  ),
  lock: (
    <g {...stroke}>
      <rect x="5" y="10.6" width="14" height="9.6" rx="2" />
      <path d="M8.2 10.6V8a3.8 3.8 0 0 1 7.6 0v2.6" />
    </g>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** CSS size, e.g. 18 or '1.2em'. Defaults to 1em. */
  size?: number | string;
  /** Accessible label; omit for decorative icons. */
  title?: string;
}

export function Icon({ name, size, title, className, style, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ? `icon ${className}` : 'icon'}
      style={size !== undefined ? { width: size, height: size, ...style } : style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {GLYPHS[name]}
    </svg>
  );
}

/** Bare glyph paths (no <svg> wrapper) for embedding an icon inside another SVG. Design box is 24x24. */
export function IconGlyph({ name }: { name: IconName }) {
  return <>{GLYPHS[name]}</>;
}
