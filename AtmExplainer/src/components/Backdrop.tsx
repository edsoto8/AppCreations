import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { COLORS } from '../theme';

/**
 * Dark navy stage: radial key light behind the subject, a faint engineering grid that drifts slowly,
 * and a soft vignette. `lightX` moves the key light to wherever the subject is.
 */
export const Backdrop: React.FC<{ lightX?: number; lightY?: number }> = ({ lightX = 1200, lightY = 520 }) => {
  const frame = useCurrentFrame();
  const drift = (frame * 0.25) % 80;
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bgDeep }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 700px at ${lightX}px ${lightY}px, rgba(40, 90, 190, 0.38), rgba(10, 21, 48, 0.0) 70%), linear-gradient(180deg, ${COLORS.bg} 0%, ${COLORS.bgDeep} 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${COLORS.grid} 1px, transparent 1px), linear-gradient(90deg, ${COLORS.grid} 1px, transparent 1px)`,
          backgroundSize: '80px 80px',
          backgroundPosition: `${drift}px ${drift}px`,
          maskImage: 'radial-gradient(ellipse at 60% 50%, black 30%, transparent 80%)',
        }}
      />
      {/* floor plane */}
      <AbsoluteFill style={{ top: 860, background: 'linear-gradient(180deg, rgba(60,110,220,0.08), rgba(0,0,0,0) 60%)' }} />
      <AbsoluteFill style={{ boxShadow: 'inset 0 0 260px 80px rgba(0,0,0,0.75)' }} />
    </AbsoluteFill>
  );
};
