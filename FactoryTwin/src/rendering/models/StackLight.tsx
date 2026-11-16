import { useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import type { Mesh } from 'three';
import type { StackLightAnim } from './anims';
import { blink } from './anims';
import { Parts, lazy } from './geometries';
import { lampMats, paintMat } from './materials';

const TIER_Y0 = 0.24;
const TIER_H = 0.075;
const R = 0.045;
/** Bottom to top: green, amber, red, blue. */
const OFF_COLORS = ['#1f4a2a', '#5a4310', '#5a1a16', '#1a2c55'];

const geo = lazy(() => {
  const p = new Parts()
    .cyl(0.06, 0.07, 0.03, '#2b2f34', [0, 0.015, 0], undefined, 20)
    .cyl(0.014, 0.014, TIER_Y0 - 0.03, '#b9c0c7', [0, 0.03 + (TIER_Y0 - 0.03) / 2, 0], undefined, 10)
    .cyl(R + 0.004, R + 0.004, 0.012, '#2b2f34', [0, TIER_Y0 - 0.006, 0], undefined, 20);
  for (let i = 0; i < 4; i++) {
    const y0 = TIER_Y0 + i * TIER_H;
    p.cyl(R, R, TIER_H - 0.01, OFF_COLORS[i], [0, y0 + (TIER_H - 0.01) / 2, 0], undefined, 20);
    p.cyl(R + 0.003, R + 0.003, 0.01, '#c9cfd5', [0, y0 + TIER_H - 0.005, 0], undefined, 20);
  }
  p.cyl(R - 0.01, R + 0.003, 0.025, '#2b2f34', [0, TIER_Y0 + 4 * TIER_H + 0.012, 0], undefined, 20);
  const lit = new Parts().cyl(R + 0.002, R + 0.002, TIER_H - 0.012, '#fff', [0, 0, 0], undefined, 20).build();
  return { body: p.build(), lit };
});

const LIT_MATS = [lampMats.green, lampMats.amber, lampMats.red, lampMats.blue];

export type StackLightProps = ThreeElements['group'] & { anim: StackLightAnim };

/**
 * Signal tower (green / amber / red + blue on top), ~0.56 m tall, origin at its base.
 * Lit tiers are shared emissive shells toggled by visibility, so a tower costs 1 draw call
 * plus one per lit tier. Blinking follows `anim.clock` (sim seconds).
 */
export function StackLight({ anim, ...props }: StackLightProps) {
  const g = geo();
  const green = useRef<Mesh>(null);
  const amber = useRef<Mesh>(null);
  const red = useRef<Mesh>(null);
  const blue = useRef<Mesh>(null);

  useFrame(() => {
    if (!green.current || !amber.current || !red.current || !blue.current) return;
    let gOn = false;
    let aOn = false;
    let rOn = false;
    let bOn = false;
    switch (anim.state) {
      case 'running':
        gOn = true;
        break;
      case 'idle':
      case 'starved':
        aOn = true;
        break;
      case 'blocked':
        aOn = blink(anim.clock, 1);
        break;
      case 'failed':
        rOn = blink(anim.clock, 2);
        break;
      case 'maintenance':
        bOn = true;
        break;
      case 'unstaffed':
        aOn = true;
        rOn = true;
        break;
      case 'closed':
        break;
    }
    green.current.visible = gOn;
    amber.current.visible = aOn;
    red.current.visible = rOn;
    blue.current.visible = bOn;
  });

  const refs = [green, amber, red, blue];
  return (
    <group {...props}>
      <mesh geometry={g.body} material={paintMat} />
      {refs.map((ref, i) => (
        <mesh
          key={i}
          ref={ref}
          geometry={g.lit}
          material={LIT_MATS[i]}
          position={[0, TIER_Y0 + i * TIER_H + (TIER_H - 0.01) / 2, 0]}
          visible={false}
        />
      ))}
    </group>
  );
}
