import type { MapPreset } from '../../sim';

/** Tiny stylised map thumbnails, one per preset. */
export function PresetArt({ preset }: { preset: MapPreset }) {
  return (
    <svg className="preset-art" viewBox="0 4 96 52" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      {preset === 'continent' && (
        <>
          <rect width="96" height="60" fill="#2a5d7a" />
          <path d="M10 34c-2-12 8-24 24-26 12-2 18 4 30 3 14-1 24 8 21 22-3 14-16 22-34 22-16 0-39-3-41-21Z" fill="#6f9a4c" stroke="#d9c98f" strokeWidth="2" />
          <path d="M26 22c8-3 14 1 12 7s-12 6-14 1c-1-3 0-6 2-8Z" fill="#2a5d7a" />
          <g fill="#3f6b33">
            <circle cx="60" cy="22" r="4" />
            <circle cx="67" cy="27" r="3.4" />
            <circle cx="56" cy="30" r="3" />
            <circle cx="30" cy="40" r="3.4" />
          </g>
          <path d="M44 38l5-8 5 8Z M52 40l4-6 4 6Z" fill="#8c8f93" />
        </>
      )}
      {preset === 'archipelago' && (
        <>
          <rect width="96" height="60" fill="#2f6f8f" />
          <g fill="#6f9a4c" stroke="#e1d39b" strokeWidth="1.6">
            <path d="M14 20c0-7 9-10 15-6 5 3 4 11-2 13-6 2-13-1-13-7Z" />
            <path d="M44 10c4-4 12-3 14 2 2 4-2 9-8 9-6 0-10-6-6-11Z" />
            <path d="M64 34c4-6 16-5 19 1 3 6-3 14-12 13-8-1-11-8-7-14Z" />
            <path d="M24 44c3-4 10-4 12 0s-1 9-7 9c-6 0-8-5-5-9Z" />
            <path d="M82 12c3-2 7 0 7 3s-3 5-6 4c-3-1-3-5-1-7Z" />
          </g>
          <g fill="#3f6b33">
            <circle cx="22" cy="20" r="3" />
            <circle cx="74" cy="38" r="3.2" />
          </g>
          <path d="M34 32h6M52 30h6" stroke="#87c2dc" strokeWidth="2" strokeLinecap="round" opacity=".6" />
        </>
      )}
      {preset === 'highlands' && (
        <>
          <rect width="96" height="60" fill="#76874f" />
          <path d="M0 60 12 26l9 14 9-22 12 28 10-16 11 22 9-18 24 26Z" fill="#8b8579" />
          <path d="M12 26l-4 10 6-2ZM30 18l-5 12 8-3ZM52 24l-4 8 7-2Z" fill="#e8e4da" />
          <path d="M0 60 18 44l14 16ZM54 60l16-14 26 14Z" fill="#6b665c" />
          <circle cx="76" cy="16" r="5" fill="#2f6f8f" />
          <g fill="#3f6b33">
            <circle cx="8" cy="52" r="3" />
            <circle cx="40" cy="54" r="3" />
          </g>
        </>
      )}
      {preset === 'riverValley' && (
        <>
          <rect width="96" height="60" fill="#7fa655" />
          <path d="M0 0h24l-6 30 8 30H0ZM96 0H74l8 24-8 36h22Z" fill="#8b8579" />
          <path d="M40-2c10 12-4 18 4 28s14 14 6 36" fill="none" stroke="#4d93b8" strokeWidth="9" strokeLinecap="round" />
          <path d="M40-2c10 12-4 18 4 28s14 14 6 36" fill="none" stroke="#7fc0de" strokeWidth="3" strokeLinecap="round" opacity=".7" />
          <g fill="#3f6b33">
            <circle cx="30" cy="14" r="3" />
            <circle cx="62" cy="20" r="3.2" />
            <circle cx="64" cy="44" r="3" />
            <circle cx="30" cy="48" r="3.4" />
          </g>
          <g fill="#d9c070">
            <rect x="34" y="30" width="7" height="5" rx="1" />
            <rect x="56" y="32" width="7" height="5" rx="1" />
          </g>
        </>
      )}
    </svg>
  );
}
