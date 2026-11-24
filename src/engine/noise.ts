import * as THREE from 'three';
import { BotanicalColorPair, FlowerSpecies } from '../types/meadow';

// Deterministic seeded permutation table for 2D Simplex Noise
const PERM = new Uint8Array(512);
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

(function initNoiseTable() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let seed = 43191119; // 43°19'N 11°19'E — Val d'Orcia seed
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255];
  }
})();

const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

export function simplex2D(xin: number, yin: number): number {
  let n0 = 0;
  let n1 = 0;
  let n2 = 0;

  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const X0 = i - t;
  const Y0 = j - t;
  const x0 = xin - X0;
  const y0 = yin - Y0;

  let i1: number;
  let j1: number;
  if (x0 > y0) {
    i1 = 1;
    j1 = 0;
  } else {
    i1 = 0;
    j1 = 1;
  }

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1.0 + 2.0 * G2;
  const y2 = y0 - 1.0 + 2.0 * G2;

  const ii = i & 255;
  const jj = j & 255;
  const gi0 = PERM[ii + PERM[jj]] & 7;
  const gi1 = PERM[ii + i1 + PERM[jj + j1]] & 7;
  const gi2 = PERM[ii + 1 + PERM[jj + 1]] & 7;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) {
    t0 *= t0;
    n0 = t0 * t0 * (GRAD2[gi0][0] * x0 + GRAD2[gi0][1] * y0);
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) {
    t1 *= t1;
    n1 = t1 * t1 * (GRAD2[gi1][0] * x1 + GRAD2[gi1][1] * y1);
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) {
    t2 *= t2;
    n2 = t2 * t2 * (GRAD2[gi2][0] * x2 + GRAD2[gi2][1] * y2);
  }

  return 70.0 * (n0 + n1 + n2);
}

export function fbm2D(x: number, y: number, octaves = 3): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1.0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += amp * simplex2D(x * freq, y * freq);
    norm += amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return value / norm;
}

/**
 * Shared meadow heightfield used identically by terrain mesh, raycaster,
 * grass blades, flower stems, fireflies, and camera ground-clearance clamp.
 */
export function getTerrainHeight(x: number, z: number): number {
  // Broad lyrical Tuscan meadow swells
  const macroRoll = simplex2D(x * 0.022 + 0.4, z * 0.020 - 0.3) * 0.62;
  const secondarySwell = simplex2D(x * 0.052 - 1.7, z * 0.048 + 1.1) * 0.24;
  const microUndulation = simplex2D(x * 0.14 + 3.2, z * 0.14 - 2.4) * 0.055;

  // Subtle amphitheater rise toward the mid/far horizon so distant colour drifts
  // are naturally visible from a low eye-level camera
  const horizonRise = Math.max(0, -z - 4.0) * 0.018;

  // Soft lateral framing rise at wide edges
  const edgeLift = Math.pow(Math.abs(x) * 0.016, 2.0) * 0.55;

  return macroRoll + secondarySwell + microUndulation + horizonRise + edgeLift;
}

export function getTerrainNormal(x: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
  const eps = 0.25;
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);
  return target.set(hL - hR, 2.0 * eps, hD - hU).normalize();
}

// Sun-baked natural botanical colour palettes (strictly zero neon, rich pigment depth)
export const BOTANICAL_SWATCHES = {
  crimson: [
    { primary: '#9B0F1E', secondary: '#54060F' }, // Deep ruby poppy/ranunculus
    { primary: '#B81829', secondary: '#6D0916' }, // Sunlit crimson
    { primary: '#A81E42', secondary: '#630C25' }, // Berry carmine
    { primary: '#C43658', secondary: '#821833' }, // Warm magenta-rose
  ] as BotanicalColorPair[],
  rose: [
    { primary: '#CC667D', secondary: '#963A50' }, // Dusty botanical rose
    { primary: '#D98699', secondary: '#A85267' }, // Soft petal pink
    { primary: '#C47E8B', secondary: '#8A4956' }, // Mauve blush
  ] as BotanicalColorPair[],
  tangerine: [
    { primary: '#CF2F0E', secondary: '#821604' }, // Vermilion field poppy
    { primary: '#DC4B12', secondary: '#962706' }, // Burnt tangerine
    { primary: '#E4661B', secondary: '#A63C09' }, // Persimmon orange
    { primary: '#E6822E', secondary: '#B05312' }, // Sun-baked apricot
  ] as BotanicalColorPair[],
  marigold: [
    { primary: '#DC8E12', secondary: '#9E5806' }, // Marigold ochre
    { primary: '#E5B429', secondary: '#AD7B0E' }, // Buttercup yellow
    { primary: '#E6C955', secondary: '#B39024' }, // Sunlit buttercup
  ] as BotanicalColorPair[],
  ivory: [
    { primary: '#EFE4CC', secondary: '#C7B084' }, // Warm archival cream
    { primary: '#EADBC0', secondary: '#BEA376' }, // Sunlit parchment ivory
    { primary: '#EED6CE', secondary: '#C2968D' }, // Blush ivory poppy
  ] as BotanicalColorPair[],
};

export interface AmbientZoneSample {
  density: number;
  species: FlowerSpecies;
  color: BotanicalColorPair;
}

/**
 * Computes organic sweeping colour bands across the terrain matching the reference
 * photograph: rich tangerine/crimson/rose-pink/marigold tapestry in the foreground
 * & midground, sweeping crimson & rose bands across the mid-distance, and delicate
 * (~10%) warm ivory accents throughout.
 */
export function sampleMeadowBotanicalZone(x: number, z: number, rng: number): AmbientZoneSample {
  const warpX = x + simplex2D(x * 0.045, z * 0.045) * 6.5;
  const warpZ = z + simplex2D(x * 0.045 + 9.2, z * 0.045 - 4.1) * 5.0;

  // Diagonal sweeping band coordinate
  const bandSignal = simplex2D(warpX * 0.045 + warpZ * 0.078, warpZ * 0.058 - warpX * 0.022);
  const pocketSignal = simplex2D(warpX * 0.13 - 3.4, warpZ * 0.13 + 5.1);

  // Natural meadow clearing/cluster density modulation
  const densityWave = 0.62 + 0.38 * simplex2D(warpX * 0.08 + 2.1, warpZ * 0.08 - 1.7);

  // Mid-distance crimson sweep (like the red/pink band in the reference photo around z = -10..-35)
  const crimsonBandBias = z < -9 && z > -36 ? 0.26 : 0.0;

  const selector = bandSignal + crimsonBandBias + (rng - 0.5) * 0.42;

  let paletteGroup: BotanicalColorPair[];
  let species: FlowerSpecies;

  if (selector > 0.26) {
    // Deep crimson, ruby & dusty rose drift
    paletteGroup = rng > 0.34 ? BOTANICAL_SWATCHES.crimson : BOTANICAL_SWATCHES.rose;
    species = pocketSignal > 0.02 ? 'ranunculus' : 'poppy';
  } else if (selector > -0.14) {
    // Burnt tangerine & vermilion poppy drift
    paletteGroup = BOTANICAL_SWATCHES.tangerine;
    species = rng > 0.26 ? 'poppy' : 'ranunculus';
  } else if (selector > -0.44) {
    // Marigold, buttercup & rose tapestry
    paletteGroup = pocketSignal > -0.05 ? BOTANICAL_SWATCHES.marigold : BOTANICAL_SWATCHES.rose;
    species = pocketSignal > 0.12 ? 'ranunculus' : 'poppy';
  } else {
    // Delicate warm ivory & poppy-orange scatter
    paletteGroup = rng > 0.42 ? BOTANICAL_SWATCHES.tangerine : BOTANICAL_SWATCHES.ivory;
    species = rng > 0.30 ? 'poppy' : 'ranunculus';
  }

  // Occasional contrasting botanical accent (8% chance, just like real wildflower seed scatter)
  if (rng > 0.92) {
    const accents = [
      ...BOTANICAL_SWATCHES.ivory,
      ...BOTANICAL_SWATCHES.crimson,
      ...BOTANICAL_SWATCHES.tangerine,
    ];
    const idx = Math.floor(((rng * 9973) % 1) * accents.length);
    return {
      density: densityWave,
      species: rng > 0.96 ? 'ranunculus' : 'poppy',
      color: accents[idx],
    };
  }

  const colorIdx = Math.min(
    paletteGroup.length - 1,
    Math.floor(((Math.abs( warpX * 13.37 + warpZ * 7.91 ) + rng * 17.3) % 1) * paletteGroup.length)
  );

  return {
    density: densityWave,
    species,
    color: paletteGroup[colorIdx],
  };
}
