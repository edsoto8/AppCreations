import { Composition } from 'remotion';
import { ATMExplainer } from './ATMExplainer';
import { fontsReady } from './fonts';

// Fonts are bundled locally; Remotion waits for them before rendering frames.
void fontsReady;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="ATMExplainer" component={ATMExplainer} durationInFrames={1800} fps={30} width={1920} height={1080} />
    </>
  );
};
