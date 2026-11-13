import type { PickId } from '../interaction/InteractionController';

export interface PartInfo {
  name: string;
  description: string;
  function: string;
}

/** Copy for the information panel. */
export const PART_INFO: Record<PickId, PartInfo> = {
  'front-shell': {
    name: 'Front housing',
    description: 'Injection-moulded light-grey ABS with a softly bevelled edge and the signature rounded bottom-right corner.',
    function: 'Holds the lens, the button membrane and the display board. Joined to the rear housing along the moulded seam.',
  },
  'back-shell': {
    name: 'Rear housing',
    description: 'Carries the cartridge bay, the battery compartment and six screws that clamp the two halves together.',
    function: 'Structural back half. The open bay lets the cartridge label face outwards when inserted.',
  },
  lens: {
    name: 'Screen lens',
    description: 'A dark printed acrylic lens with the display caption, colour stripes and the power indicator window.',
    function: 'Protects the LCD and frames the 160 × 144 pixel window.',
  },
  screen: {
    name: 'Dot-matrix LCD',
    description: 'A reflective 160 × 144 pixel display with four shades of green and a slow, slightly ghosting pixel response.',
    function: 'Shows the boot animation and the game. The contrast wheel shifts how dark the shades appear.',
  },
  led: {
    name: 'Power indicator',
    description: 'A red LED behind the lens.',
    function: 'Glows while the console is switched on.',
  },
  dpad: {
    name: 'Direction pad',
    description: 'A one-piece cross that pivots on a central nub over four conductive contacts.',
    function: 'Moves pieces, steers and navigates menus. Press near an arm (or a corner for diagonals).',
  },
  'button-a': {
    name: 'A button',
    description: 'A domed burgundy button over a silicone contact.',
    function: 'Primary action: rotate clockwise, accelerate, confirm.',
  },
  'button-b': {
    name: 'B button',
    description: 'A domed burgundy button over a silicone contact.',
    function: 'Secondary action: rotate counter-clockwise, brake, back.',
  },
  'button-start': {
    name: 'START button',
    description: 'A soft rubber pill, angled to match the A/B diagonal.',
    function: 'Starts a game from the title screen and pauses during play.',
  },
  'button-select': {
    name: 'SELECT button',
    description: 'A soft rubber pill next to START.',
    function: 'Toggles title-screen options such as music or game mode.',
  },
  'power-switch': {
    name: 'Power switch',
    description: 'A slider on the top edge. While ON, its tab locks the cartridge in place.',
    function: 'Click to switch the console on or off. Turning on runs the boot sequence.',
  },
  'volume-wheel': {
    name: 'Volume wheel',
    description: 'A knurled thumb wheel on the right side driving a potentiometer.',
    function: 'Drag up/down or scroll over it to change the speaker volume.',
  },
  'contrast-wheel': {
    name: 'Contrast wheel',
    description: 'A knurled thumb wheel on the left side.',
    function: 'Drag up/down or scroll over it to adjust LCD contrast.',
  },
  'link-port': {
    name: 'Link port',
    description: 'A six-pin serial connector on the left side.',
    function: 'For a link cable to a second console (decorative in this model).',
  },
  'phones-jack': {
    name: 'Headphone jack',
    description: '3.5 mm stereo socket on the bottom edge.',
    function: 'Stereo output for headphones (decorative in this model).',
  },
  'dc-jack': {
    name: 'DC input',
    description: '6 V barrel socket on the left side.',
    function: 'External power instead of batteries (decorative in this model).',
  },
  speaker: {
    name: 'Speaker',
    description: 'A small paper-cone speaker behind the angled grille slots.',
    function: 'Plays the chiptune music and sound effects. Volume follows the wheel.',
  },
  'battery-cover': {
    name: 'Battery door',
    description: 'A sliding door with grip ridges on the back of the console.',
    function: 'Click to slide it open and reveal the four AA cells. Click again to close.',
  },
  batteries: {
    name: 'AA batteries',
    description: 'Four 1.5 V cells in series, with springs and contact nubs.',
    function: 'Power for the console.',
  },
  'cartridge-bay': {
    name: 'Cartridge slot',
    description: 'An open bay at the top of the back with a 32-pin edge connector.',
    function: 'Accepts game cartridges. Use the cartridge library or click a cartridge to insert it.',
  },
  'lcd-board': {
    name: 'Display board',
    description: 'The front circuit board with carbon contact pads and the LCD ribbon connection.',
    function: 'Senses button presses through the membrane and drives the LCD.',
  },
  'cpu-board': {
    name: 'Main board',
    description: 'The processor, work RAM, video RAM, oscillator crystal, capacitors and the cartridge connector.',
    function: 'Runs the game code and generates video and sound.',
  },
  membrane: {
    name: 'Button membrane',
    description: 'A silicone sheet with conductive domes under every button.',
    function: 'Gives the buttons their springy feel and closes the circuit when pressed.',
  },
  screws: {
    name: 'Case screws',
    description: 'Six cross-head screws hold the housing together.',
    function: 'Removed first when disassembling (see the exploded view).',
  },
  cartridge: {
    name: 'Game cartridge',
    description: 'A plastic shell with a label, grip ridges and a gold edge connector.',
    function: 'Click it to insert or remove it. Switch the power off first.',
  },
};
