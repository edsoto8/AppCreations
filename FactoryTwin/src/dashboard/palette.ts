/**
 * Chart colours: the dataviz reference palette, dark-mode steps (validated for CVD separation on
 * a dark surface). Categorical slots are assigned in fixed order and follow the entity.
 */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];

/** Status colours are reserved for state and always paired with a text label. */
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b', neutral: '#475569' };

export const MATERIAL_COLOR: Record<string, string> = {
  PCB: SERIES[0],
  ENCLOSURE: SERIES[1],
  SENSOR: SERIES[2],
  SPEAKER_DRIVER: SERIES[3],
  BATTERY: SERIES[4],
  PACKAGING_KIT: SERIES[6],
};

export const STAGE_COLOR: Record<string, string> = {
  Assembly: SERIES[0],
  Inspection: SERIES[1],
  Packaging: SERIES[2],
};

export const AXIS = { stroke: '#3b4a60', tick: { fill: '#8b9bb2', fontSize: 10 } };
export const GRID = '#1f2b3c';
