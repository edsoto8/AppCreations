/** Inspector names and engineering descriptions for the robot's parts. */
export const ROBOT_PARTS: Record<string, { name: string; description: string }> = {
  chassis: {
    name: 'Chassis & underside pan',
    description:
      'Glass-fibre reinforced ABS/PC monocoque that carries every module. The underside pan has wheel wells, the roller intake opening and screw bosses; twin rear-flank louvres exhaust filtered air from the suction fan.',
  },
  topCover: {
    name: 'Top cover',
    description:
      'Two-tone top shell: a pearl clear-coated outer ring with a 12 mm chamfer and a deep-graphite piano-finish deck. The rear section is a hinged lid that opens for dust-bin access.',
  },
  buttons: {
    name: 'Control buttons',
    description:
      'Two tactile metal-dome buttons (power/start and return-to-dock) with backlit icons. Long-pressing both triggers Wi-Fi pairing.',
  },
  lidar: {
    name: 'LiDAR turret',
    description:
      'Rotating laser distance sensor (905 nm emitter + receiver lens) spinning at ~5 Hz to produce 360-degree range scans for SLAM mapping and localization. The smoked window band is IR-transparent.',
  },
  ledRing: {
    name: 'LED status ring',
    description:
      'Addressable RGB light guide around the deck. Colour and animation encode the robot state: cyan sweep while mapping, teal while cleaning, blue chase when returning, amber fill while charging, red blink on error.',
  },
  bumper: {
    name: 'Front bumper',
    description:
      'Floating 200-degree impact shell on spring guides with a soft rubber strip. Contact pushes it up to 8 mm back against micro-switches, telling the controller the side and direction of the collision.',
  },
  camera: {
    name: 'Camera + structured light',
    description:
      'Front RGB camera flanked by two structured-light line emitters and a ToF receiver behind black glass. Together they detect and classify low obstacles such as cables, socks and pet waste.',
  },
  cliffSensors: {
    name: 'Cliff sensors',
    description:
      'Six downward infrared emitter/receiver pairs (four front, two rear). A weak reflection means a drop-off such as a stair edge, and the robot immediately stops and backs away.',
  },
  chargingContacts: {
    name: 'Charging contacts',
    description:
      'Gold-plated spring-contact pads on the front underside. They land on the dock base-plate contacts to charge the pack at up to 24 V / 2 A.',
  },
  leftWheel: {
    name: 'Left drive wheel',
    description:
      'Independently driven 72 mm wheel with a chevron-tread rubber tyre and brushed aluminium hub. An optical encoder on the gearbox provides odometry for dead reckoning.',
  },
  rightWheel: {
    name: 'Right drive wheel',
    description:
      'Mirror of the left wheel. Differential speed between the two wheels steers the robot; turning in place spins them in opposite directions.',
  },
  suspension: {
    name: 'Suspension',
    description:
      'Trailing arms that pivot on the drive-motor axis and carry the reduction gearboxes. Coil springs keep the tyres loaded so the chassis can rise over thresholds and carpet edges up to 20 mm.',
  },
  caster: {
    name: 'Caster wheel',
    description:
      'Free-swivelling front caster that provides the third contact point. Its trailing offset lets it align with the direction of travel.',
  },
  sideBrush: {
    name: 'Side brush',
    description:
      'Three-arm brush with splayed nylon bristle fans driven by its own motor. It sweeps debris from wall edges and corners into the path of the main rollers.',
  },
  mainBrush: {
    name: 'Main roller brushes',
    description:
      'Two counter-rotating rollers: a bristle helix that agitates carpet pile and a rubber chevron flap roller that lifts fine dust and resists hair tangling. They feed debris up into the dust bin.',
  },
  mopPads: {
    name: 'Mop pads',
    description:
      'Twin counter-rotating microfiber pads (~180 rpm) on a lift linkage. They lower to scrub hard floors and retract by 8 mm on carpet or when docking.',
  },
  dustbin: {
    name: 'Dustbin',
    description:
      'Removable 300 ml smoked-polycarbonate bin with a one-way inlet flap. Its fill level is estimated from airflow drop and emptied automatically by the dock.',
  },
  hepaFilter: {
    name: 'HEPA filter',
    description:
      'Washable pleated E11 HEPA cartridge between the bin and the fan. The pleats maximise surface area to capture 99.9% of particles down to 0.3 micrometres.',
  },
  waterTank: {
    name: 'Water tank',
    description:
      'Translucent 200 ml clean-water reservoir forming the rear of the body. A micro-pump meters water to the mop pads and the dock refills it automatically.',
  },
  battery: {
    name: 'Battery pack',
    description:
      '4S2P Li-ion pack of eight 18650 cells (14.4 V, 5.2 Ah) with a battery management board for cell balancing, temperature and over-current protection.',
  },
  mainboard: {
    name: 'Mainboard',
    description:
      'Main controller PCB: quad-core SoC under a finned heat-sink, LPDDR memory, power management IC, shielded Wi-Fi module and motor drivers. Runs SLAM, path planning and the safety logic.',
  },
  imu: {
    name: 'IMU',
    description:
      '6-axis gyroscope + accelerometer mounted near the rotation centre. It measures heading changes and tilt to correct wheel odometry and detect when the robot is lifted or stuck.',
  },
  suctionFan: {
    name: 'Suction fan',
    description:
      'Brushless centrifugal fan (up to 8000 Pa) with a backward-curved impeller in a smoked volute. It pulls air through the intake, bin and HEPA filter and exhausts it through the rear louvres.',
  },
};
