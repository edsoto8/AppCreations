import React from 'react';
import { Audio } from '@remotion/media';
import { spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORS, FONT } from '../theme';

/** Eyebrow + headline in the top-left safe area, used to name each chapter of the explainer. */
export const SceneHeading: React.FC<{ eyebrow: string; title: string; note?: string; at?: number; opacity?: number }> = ({ eyebrow, title, note, at = 0, opacity = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 200 }, durationInFrames: 20 });
  return (
    <div style={{ position: 'absolute', left: 110, top: 92, width: 1100, opacity: s * opacity, translate: `${(1 - s) * -30}px 0` }}>
      <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 24, letterSpacing: 5, color: COLORS.amber, textTransform: 'uppercase' }}>{eyebrow}</div>
      <div style={{ fontFamily: FONT.sans, fontWeight: 800, fontSize: 64, color: COLORS.white, marginTop: 8, lineHeight: 1.05 }}>{title}</div>
      {note && <div style={{ fontFamily: FONT.sans, fontWeight: 500, fontSize: 24, color: COLORS.muted, marginTop: 12 }}>{note}</div>}
    </div>
  );
};

/** One sound effect placed at a frame (relative to the enclosing sequence). Assets are original (see public/audio/LICENSE.md). */
export const Sfx: React.FC<{ name: string; file: string; at: number; volume?: number; durationInFrames?: number; loop?: boolean }> = ({
  name,
  file,
  at,
  volume = 0.6,
  durationInFrames,
  loop,
}) => <Audio name={name} src={staticFile(`audio/${file}`)} from={at} durationInFrames={durationInFrames} volume={volume} loop={loop} />;
