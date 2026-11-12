import { BoxGeometry, CircleGeometry, CylinderGeometry, Group, TorusGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ROBOT } from '../../../sim/robot/robotSpec';
import type { BuildContext } from '../shared/context';
import { lathe, mat } from '../shared/geometry';

/**
 * LiDAR turret: fixed machined collar, spinning head with a smoked window band, internal laser
 * emitter / receiver optics and a machined cap. `rotor` is spun about +Y by lidarAngle.
 */
export function buildLidar(ctx: BuildContext): { root: Group; rotor: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'lidar';
  root.position.set(ROBOT.lidarOffsetX, 0, 0);
  const seg = Math.ceil(q.radial * 0.6);

  const fixed = ctx.builder();
  fixed.add(lathe([[0.0458, 0.0742], [0.0458, 0.0828, 0.0008], [0.0446, 0.0835, -1], [0.0405, 0.0835]], seg, q.fillet), mats.titanium);
  fixed.add(new CylinderGeometry(0.014, 0.014, 0.01, q.radialSmall), mats.titanium, mat(0, 0.067, 0));
  fixed.add(new CylinderGeometry(0.021, 0.021, 0.0012, q.radialSmall * 2), mats.pcb, mat(0, 0.0732, 0));
  fixed.build(root, { castShadow: true, name: 'lidar-collar' });

  const rotor = new Group();
  rotor.name = 'lidarRotor';
  root.add(rotor);

  const head = ctx.builder();
  head.add(lathe([[0.039, 0.0835], [0.0416, 0.0836, 0], [0.0416, 0.0867, 0], [0.039, 0.0868]], seg, 1), mats.titanium);
  head.add(lathe([[0.0412, 0.0954], [0.0419, 0.0957, 0.0005], [0.0419, 0.0971, 0.0012], [0.0396, 0.0995, 0.002], [0.019, 0.0999, -1], [0, 0.0999]], seg, q.fillet), mats.brushedAlu);
  head.add(lathe([[0.0172, ROBOT.height - 0.0002], [0.0172, ROBOT.height + 0.0004, 0.0003], [0, ROBOT.height + 0.0006]], seg, 2), mats.titanium);
  head.add(new TorusGeometry(0.0176, 0.00045, 6, seg), mats.champagne, mat(0, ROBOT.height, 0, -Math.PI / 2, 0, 0));
  head.add(new RoundedBoxGeometry(0.008, 0.0006, 0.0018, 1, 0.0002), mats.champagne, mat(0.029, 0.0999, 0));
  // Internals visible through the window band.
  head.add(new CircleGeometry(0.0395, seg), mats.blackMatte, mat(0, 0.0869, 0, -Math.PI / 2, 0, 0));
  head.add(new CircleGeometry(0.0408, seg), mats.blackMatte, mat(0, 0.0953, 0, Math.PI / 2, 0, 0));
  head.add(new RoundedBoxGeometry(0.022, 0.0075, 0.017, 2, 0.0015), mats.titanium, mat(0.004, 0.0911, 0));
  head.add(new CylinderGeometry(0.0047, 0.0047, 0.003, q.radialSmall), mats.titanium, mat(0.0155, 0.0911, 0.0042, 0, 0, Math.PI / 2));
  head.add(new CylinderGeometry(0.0039, 0.0039, 0.0032, q.radialSmall), mats.lens, mat(0.0157, 0.0911, 0.0042, 0, 0, Math.PI / 2));
  head.add(new CylinderGeometry(0.0021, 0.0021, 0.0036, q.radialSmall), mats.titanium, mat(0.0155, 0.0911, -0.0048, 0, 0, Math.PI / 2));
  head.add(new BoxGeometry(0.012, 0.006, 0.014), mats.titanium, mat(-0.026, 0.0906, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    head.add(new CylinderGeometry(0.0016, 0.0016, 0.0087, 8), mats.titanium, mat(Math.sin(a) * 0.0385, 0.0911, Math.cos(a) * 0.0385));
  }
  head.build(rotor, { castShadow: true, name: 'lidar-head' });

  const emit = ctx.builder();
  emit.add(new CylinderGeometry(0.0013, 0.0013, 0.0008, q.radialSmall), mats.laser, mat(0.0176, 0.0911, -0.0048, 0, 0, Math.PI / 2));
  emit.build(rotor, { name: 'lidar-laser' });

  const glass = ctx.builder();
  glass.add(new CylinderGeometry(0.0412, 0.0412, 0.0087, seg, 1, true), mats.smokedGlass, mat(0, 0.0911, 0));
  glass.build(rotor, { name: 'lidar-window', renderOrder: 2 });
  return { root, rotor };
}
