import type { Appearance } from '../../sim';

/** Procedural palettes: the sim stores variant indices (0..7), the UI picks the colours. */
export const SKIN_TONES = ['#f6d3b3', '#efc29b', '#e0a878', '#c98a5e', '#a86a43', '#8a4f2f', '#6b3a22', '#f3cdb0'] as const;
export const HAIR_COLORS = ['#2a1b12', '#4a2f1b', '#7a4a22', '#b9793a', '#d8b25a', '#a33a22', '#8c8c92', '#1a1a1e'] as const;
export const SHIRT_COLORS = ['#c0533a', '#3f7fb5', '#5f9a45', '#d3a73a', '#8a5aa8', '#3c9a8f', '#d8d0bc', '#7a4a2a'] as const;

const pick = <T,>(list: readonly T[], i: number): T => list[((Math.floor(i) % list.length) + list.length) % list.length]!;

/** A small bust portrait drawn from `Appearance`: skin, hair (colour and style) and shirt. */
export function Avatar({ appearance, size = 36, title }: { appearance: Appearance; size?: number; title?: string }) {
  const skin = pick(SKIN_TONES, appearance.skin);
  const hair = pick(HAIR_COLORS, appearance.hair);
  const shirt = pick(SHIRT_COLORS, appearance.shirt);
  const style = ((Math.floor(appearance.hair) + Math.floor(appearance.skin)) % 4 + 4) % 4;
  const hat = Math.floor(appearance.shirt) % 3 === 0;
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 40 40" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <clipPath id={`av-${size}`}>
          <circle cx="20" cy="20" r="19" />
        </clipPath>
      </defs>
      <circle cx="20" cy="20" r="19" fill="rgba(255,235,200,.12)" />
      <g clipPath={`url(#av-${size})`}>
        <path d="M5 40c0-8 6-12 15-12s15 4 15 12Z" fill={shirt} />
        <path d="M5 40c0-8 6-12 15-12s15 4 15 12" fill="none" stroke="rgba(0,0,0,.3)" strokeWidth="1" />
        <rect x="17" y="23" width="6" height="7" rx="2" fill={skin} />
        {style === 3 && <path d="M9 22c-1-9 3-16 11-16s12 7 11 16c-2-3-3-5-3-9H12c0 4-1 6-3 9Z" fill={hair} />}
        <ellipse cx="20" cy="17.5" rx="7.6" ry="8.6" fill={skin} />
        {style === 0 && <path d="M12.2 16c-.4-6 3-9.4 7.8-9.4s8.2 3.4 7.8 9.4c-1.4-2.6-4-4.2-7.8-4.2s-6.4 1.6-7.8 4.2Z" fill={hair} />}
        {style === 1 && <path d="M12 17c-1.2-7 2.4-11 8-11s9.2 4 8 11c-.8-3.6-3-6-8-6s-7.2 2.4-8 6Z" fill={hair} />}
        {style === 2 && <path d="M12.4 14.6c1-5 4-7.6 7.6-7.6s6.6 2.6 7.6 7.6c-3-1.6-5.4-3.2-7.6-3.2s-4.6 1.6-7.6 3.2Z" fill={hair} />}
        {hat && (
          <g>
            <ellipse cx="20" cy="11.4" rx="11" ry="2.6" fill="#a8803a" stroke="rgba(0,0,0,.3)" strokeWidth=".8" />
            <path d="M13.4 11c.2-5 3-7.6 6.6-7.6s6.4 2.6 6.6 7.6Z" fill="#c29a4e" stroke="rgba(0,0,0,.3)" strokeWidth=".8" />
          </g>
        )}
        <circle cx="17" cy="18.4" r="1" fill="#2a1d10" />
        <circle cx="23" cy="18.4" r="1" fill="#2a1d10" />
        <path d="M17.4 22c1.6 1.2 3.6 1.2 5.2 0" fill="none" stroke="#7a4a30" strokeWidth="1" strokeLinecap="round" />
      </g>
      <circle cx="20" cy="20" r="19" fill="none" stroke="var(--glass-border-strong)" strokeWidth="1.2" />
    </svg>
  );
}
