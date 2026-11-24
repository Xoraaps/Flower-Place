export type TimeOfDay = 'morning' | 'noon' | 'afternoon' | 'night';

export type FlowerSpecies = 'poppy' | 'ranunculus';

export interface TimePresetInfo {
  id: TimeOfDay;
  clock: string;
  label: string;
}

export const TIME_PRESETS: TimePresetInfo[] = [
  { id: 'morning', clock: '06:00', label: 'MORNING' },
  { id: 'noon', clock: '12:00', label: 'NOON' },
  { id: 'afternoon', clock: '17:30', label: 'AFTERNOON' },
  { id: 'night', clock: '23:00', label: 'NIGHT' },
];

export interface BotanicalColorPair {
  /** Primary outer petal RGB hex */
  primary: string;
  /** Inner cup / ruffled heart accent RGB hex */
  secondary: string;
}

export interface SemanticBloomProfile {
  driftName: string;
  poppyRatio: number;
  stemHeightRange: [number, number];
  densityMultiplier: number;
  palette: BotanicalColorPair[];
}

export interface SampledBloomPoint {
  /** World X coordinate on meadow */
  x: number;
  /** World Z coordinate on meadow */
  z: number;
  /** Normalized sequential stroke order 0..1 for staggered emergence */
  strokeProgress: number;
  /** Normalized vertical glyph position 0 (baseline) .. 1 (ascender) */
  glyphHeightRatio: number;
  /** Chosen flower species */
  species: FlowerSpecies;
  /** Primary petal hex */
  primaryHex: string;
  /** Secondary inner petal hex */
  secondaryHex: string;
  /** Scale multiplier */
  scale: number;
}

export interface SowEventSummary {
  phrase: string;
  driftName: string;
  stemCount: number;
}
