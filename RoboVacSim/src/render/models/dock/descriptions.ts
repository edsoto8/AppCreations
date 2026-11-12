/** Inspector names and engineering descriptions for the dock's parts. */
export const DOCK_PARTS: Record<string, { name: string; description: string }> = {
  basePlate: {
    name: 'Base plate & ramp',
    description:
      'Anti-slip docking platform with a low bevelled entry lip. The circular well centres the robot so its contacts, intake and mop pads line up with the service ports.',
  },
  washTray: {
    name: 'Mop wash tray',
    description:
      'Stainless tray under the mop pads with concentric scrubbing ribs, spray nozzles and a rotating rubber scrubber. The pads spin against the ribs while clean water is sprayed in and dirty water drains out.',
  },
  dryingVents: {
    name: 'Drying vents',
    description:
      'A heated blower (PTC element, ~45 C) pushes warm air out of the louvres beside the pads after washing, drying them in 2-3 hours to prevent odour and mildew.',
  },
  chargingContacts: {
    name: 'Charging contacts',
    description:
      'Spring-loaded gold-plated blades that press against the robot contact pads. The status LED in each pedestal glows while current flows.',
  },
  suctionDuct: {
    name: 'Self-empty suction duct',
    description:
      'Sealed channel from the base-plate inlet slot through the tower into the dust bag. The rubber lips seal against the robot intake so debris is pulled straight out of the bin.',
  },
  vacuumMotor: {
    name: 'Evacuation motor',
    description:
      'High-power (~800 W) finned vacuum motor on rubber isolation mounts. It runs for 10-15 s per cycle to empty the robot bin into the bag.',
  },
  dustBag: {
    name: 'Dust bag',
    description:
      'Sealed 3 L non-woven allergen bag with a rigid card collar. It holds about 60 days of debris and is visible through the smoked front window.',
  },
  cleanTank: {
    name: 'Clean-water tank',
    description:
      'Removable 4 L reservoir that feeds the mop wash nozzles and refills the robot water tank through the pump and heater.',
  },
  dirtyTank: {
    name: 'Dirty-water tank',
    description:
      'Removable 3.5 L reservoir with an inlet stand-pipe. Waste water is pumped up from the wash tray so the tray never stays wet.',
  },
  pumps: {
    name: 'Pumps & hoses',
    description:
      'Two diaphragm pumps, a solenoid valve and an inline water heater with silicone hoses. One loop sprays clean water into the tray, the other returns dirty water to the waste tank.',
  },
  powerSupply: {
    name: 'Power supply',
    description:
      'Fan-less switched-mode supply converting mains AC into 24 V DC for charging and the 12 V service rail for pumps, blower and electronics.',
  },
  statusDisplay: {
    name: 'Status display',
    description:
      'Front black-glass fascia with a low-power display showing the current service step and the robot battery level, plus capacitive touch keys.',
  },
  lightStrip: {
    name: 'Accent light strip',
    description:
      'Diffused LED strip whose colour and motion mirror the service phase: teal pulse while charging, flowing blue during emptying and refilling, warm amber while drying, green when ready.',
  },
  frontPanel: {
    name: 'Front service panel',
    description:
      'Magnetically retained pearl panel with an air-intake perforation. Removing it exposes the suction duct, pumps and blower for service.',
  },
  sidePanels: {
    name: 'Side panels',
    description:
      'Two removable side covers with recessed grips giving access to the evacuation motor, power supply and hose routing.',
  },
  dockHousing: {
    name: 'Tower frame',
    description:
      'Rigid internal frame with brushed aluminium corner extrusions, tank deck and rear panel with the motor exhaust grille and mains inlet.',
  },
  topLid: {
    name: 'Top lid',
    description:
      'Pearl lid with a smoked window over the dust bag. It lifts off to remove the water tanks and replace the bag.',
  },
};
