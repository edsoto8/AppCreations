import React from 'react';
import { Audio } from '@remotion/media';
import { AbsoluteFill, interpolate, Sequence, staticFile, Track, useVideoConfig } from 'remotion';
import { Caption } from './components/Caption';
import { SceneTransition } from './components/SceneTransition';
import { NARRATION } from './narration';
import { Scene1Intro } from './scenes/Scene1Intro';
import { Scene2Inside } from './scenes/Scene2Inside';
import { Scene3Request } from './scenes/Scene3Request';
import { Scene4Counting } from './scenes/Scene4Counting';
import { Scene5Dispense } from './scenes/Scene5Dispense';
import { Scene6Inventory } from './scenes/Scene6Inventory';
import { Scene7Closing } from './scenes/Scene7Closing';
import { COLORS } from './theme';

/**
 * "How Cash Works Inside an ATM" — 60 s @ 30 fps, 1920×1080.
 * Scenes sit on one track with explicit timing; captions and music sit on their own tracks.
 * Scene 1→2 and 4→5 share the same camera at the cut, so they join without a visible transition.
 */
export const ATMExplainer: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bgDeep }}>
      <Track name="Scenes">
        <Sequence name="1 · Introduction" from={0} durationInFrames={6 * fps}>
          <SceneTransition durationInFrames={6 * fps} fadeIn={10} fadeOut={0}>
            <Scene1Intro />
          </SceneTransition>
        </Sequence>
        <Sequence name="2 · Inside the ATM" from={6 * fps} durationInFrames={10 * fps}>
          <SceneTransition durationInFrames={10 * fps} fadeIn={0} fadeOut={12}>
            <Scene2Inside />
          </SceneTransition>
        </Sequence>
        <Sequence name="3 · Customer requests cash" from={16 * fps} durationInFrames={9 * fps}>
          <SceneTransition durationInFrames={9 * fps} fadeIn={12} fadeOut={12}>
            <Scene3Request />
          </SceneTransition>
        </Sequence>
        <Sequence name="4 · Selecting and counting" from={25 * fps} durationInFrames={13 * fps}>
          <SceneTransition durationInFrames={13 * fps} fadeIn={12} fadeOut={0}>
            <Scene4Counting />
          </SceneTransition>
        </Sequence>
        <Sequence name="5 · Dispensing" from={38 * fps} durationInFrames={11 * fps}>
          <SceneTransition durationInFrames={11 * fps} fadeIn={0} fadeOut={12}>
            <Scene5Dispense />
          </SceneTransition>
        </Sequence>
        <Sequence name="6 · Inventory" from={49 * fps} durationInFrames={7 * fps}>
          <SceneTransition durationInFrames={7 * fps} fadeIn={12} fadeOut={12}>
            <Scene6Inventory />
          </SceneTransition>
        </Sequence>
        <Sequence name="7 · Closing" from={56 * fps} durationInFrames={4 * fps}>
          <SceneTransition durationInFrames={4 * fps} fadeIn={12} fadeOut={24}>
            <Scene7Closing />
          </SceneTransition>
        </Sequence>
      </Track>

      <Track name="Captions">
        {NARRATION.map((n) => (
          <Sequence key={n.from} name={`Caption ${n.from.toFixed(1)}s`} from={Math.round(n.from * fps)} durationInFrames={Math.round((n.to - n.from) * fps)} layout="none">
            <Caption text={n.text} durationInFrames={Math.round((n.to - n.from) * fps)} />
          </Sequence>
        ))}
      </Track>

      <Track name="Music">
        <Audio
          name="Music bed (original)"
          src={staticFile('audio/music-bed.wav')}
          durationInFrames={60 * fps}
          volume={(f) => interpolate(f, [0, 30, 56 * fps, 60 * fps], [0.55, 0.75, 0.75, 0.6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
        />
      </Track>
    </AbsoluteFill>
  );
};
