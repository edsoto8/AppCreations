import type { BuildingType } from '../../sim';

const OUT = 'rgba(30,18,8,.55)';

const ART: Record<BuildingType, React.ReactNode> = {
  townCenter: (
    <>
      <path d="M6 40h36v-6H6Z" fill="#8a6a44" stroke={OUT} />
      <path d="M9 34V20l15-8 15 8v14Z" fill="#d6b27a" stroke={OUT} />
      <path d="M5 21 24 9l19 12-2.6 3L24 14 7.6 24Z" fill="#a8452b" stroke={OUT} />
      <rect x="20" y="25" width="8" height="9" rx="4" fill="#4a2f1b" />
      <rect x="11.6" y="24" width="4.6" height="5" rx="1" fill="#7fb9dc" stroke={OUT} />
      <rect x="31.8" y="24" width="4.6" height="5" rx="1" fill="#7fb9dc" stroke={OUT} />
      <path d="M24 12V4" stroke="#5a3a1f" strokeWidth="1.6" />
      <path d="M24 4.4h8l-2.2 2.6L32 9.6h-8Z" fill="#e8ae4d" stroke={OUT} strokeWidth=".8" />
    </>
  ),
  house: (
    <>
      <rect x="9" y="22" width="30" height="18" rx="1.5" fill="#e0c493" stroke={OUT} />
      <path d="M5 24 24 9l19 15-3 2.6L24 15 8 26.6Z" fill="#b84f2e" stroke={OUT} />
      <rect x="20.4" y="29" width="7.2" height="11" rx="1" fill="#5e3320" />
      <rect x="11.6" y="27" width="5" height="5" rx=".8" fill="#9ccbe8" stroke={OUT} />
      <rect x="31.4" y="27" width="5" height="5" rx=".8" fill="#9ccbe8" stroke={OUT} />
      <rect x="31" y="10" width="4.4" height="8" fill="#8a6a50" stroke={OUT} />
    </>
  ),
  farm: (
    <>
      <path d="M4 32 24 21l20 11-20 11Z" fill="#7a5230" stroke={OUT} />
      <g stroke="#9bc15a" strokeWidth="2.4" strokeLinecap="round">
        <path d="M9.6 31.6 24 23.6M13 34.8 29.4 25.6M17 37.8l16.4-9.2M20.6 40.4l13.4-7.4" />
      </g>
      <g fill="#e9c34f">
        <circle cx="14" cy="30.4" r="1.6" />
        <circle cx="22" cy="26" r="1.6" />
        <circle cx="30" cy="30.6" r="1.6" />
        <circle cx="25" cy="36.6" r="1.6" />
      </g>
      <path d="M36 14v14M34 17h4M34 21h4" stroke="#a8803a" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  lumberCamp: (
    <>
      <path d="M8 38 22 14l14 24Z" fill="#8a5a33" stroke={OUT} />
      <path d="M22 14 30 38H22Z" fill="#6e4524" />
      <path d="M17 38l5-9 5 9Z" fill="#3a2414" />
      <g stroke={OUT} strokeWidth=".9">
        <circle cx="34" cy="38" r="3.4" fill="#c38d54" />
        <circle cx="41" cy="38" r="3.4" fill="#c38d54" />
        <circle cx="37.5" cy="32.4" r="3.4" fill="#d6a064" />
      </g>
      <circle cx="37.5" cy="32.4" r="1.4" fill="none" stroke="#7a4a22" strokeWidth=".8" />
      <path d="M5 42h38" stroke="#4f7a37" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  mine: (
    <>
      <path d="M3 40 16 14l10 14 8-10 11 22Z" fill="#8f8a80" stroke={OUT} />
      <path d="M16 14l-4 8 5-1.6ZM34 18l-3 5 5-1Z" fill="#e8e4da" />
      <path d="M17 40V30c0-4 3-6 6-6s6 2 6 6v10Z" fill="#2a1d10" />
      <path d="M16 40V29.6M30 40V29.6M15 29.8h16" stroke="#9a6a3a" strokeWidth="2.2" strokeLinecap="round" />
      <path d="m36 34 6-8" stroke="#6b4a2a" strokeWidth="2" strokeLinecap="round" />
      <path d="M36.6 25.2c2.4-.6 4.6.6 5.6 2.6" fill="none" stroke="#c9d2da" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  well: (
    <>
      <ellipse cx="24" cy="36" rx="13" ry="5.4" fill="#8a8f95" stroke={OUT} />
      <path d="M11 36v-8c0-3 5.8-5.4 13-5.4S37 25 37 28v8c0 3-5.8 5.4-13 5.4S11 39 11 36Z" fill="#a4a9ae" stroke={OUT} />
      <ellipse cx="24" cy="28" rx="13" ry="5.4" fill="#5a5f66" stroke={OUT} />
      <ellipse cx="24" cy="28.6" rx="9.4" ry="3.6" fill="#3f8fc8" />
      <path d="M12.6 27V12M35.4 27V12" stroke="#7a4f27" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M8.6 14.4 24 6l15.4 8.4Z" fill="#a8452b" stroke={OUT} />
      <path d="M24 13v8" stroke="#d8d0bc" strokeWidth="1.2" />
      <rect x="21.4" y="20.6" width="5.2" height="4.4" rx=".8" fill="#9a6a3a" stroke={OUT} strokeWidth=".8" />
    </>
  ),
  storage: (
    <>
      <path d="M5 22 24 11l19 11v17L24 45 5 39Z" fill="#c9a06a" stroke={OUT} />
      <path d="M24 45V24L5 22v17Z" fill="#b08650" />
      <path d="M24 24 43 22v17L24 45Z" fill="#9a7440" />
      <path d="M5 22 24 11l19 11-19 2Z" fill="#a8452b" stroke={OUT} />
      <path d="M10 28v9M15 29v9M29 29v9M34 28v9" stroke="rgba(30,18,8,.35)" strokeWidth="1.4" />
    </>
  ),
  workshop: (
    <>
      <rect x="7" y="22" width="30" height="18" rx="1.5" fill="#cdbb99" stroke={OUT} />
      <path d="M4 24 22 11l18 13-2.8 2.4L22 15.6 6.8 26.4Z" fill="#6f5a45" stroke={OUT} />
      <rect x="32" y="8" width="5" height="12" fill="#8a6a50" stroke={OUT} />
      <path d="M34.5 6c-2-1.4 0-3.4-1.4-5M37 7c-1.4-1 .4-2.6-.6-4" fill="none" stroke="rgba(230,230,230,.7)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M10 30h10v10H10Z" fill="#3a2a1c" />
      <path d="M26 33h12v3.4l-1.6 1.6H27.6L26 36.4Z" fill="#6a7077" stroke={OUT} />
      <path d="M31 38v2.4h2V38" stroke="#6a7077" strokeWidth="2" />
      <path d="m41 28-4 6" stroke="#6b4a2a" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="38.6" y="25" width="5" height="3.4" rx=".8" transform="rotate(35 41 27)" fill="#c9d2da" stroke={OUT} strokeWidth=".8" />
    </>
  ),
};

/** Small illustrated icon per building type (viewBox 48x48). */
export function BuildingIcon({ type, size = 56 }: { type: BuildingType; size?: number }) {
  return (
    <svg className="building-icon" viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" fill="none" strokeLinejoin="round" strokeLinecap="round">
      {ART[type]}
    </svg>
  );
}
