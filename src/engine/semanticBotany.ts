import * as THREE from 'three';
import {
  BotanicalColorPair,
  SampledBloomPoint,
  SemanticBloomProfile,
} from '../types/meadow';
import { BOTANICAL_SWATCHES, sampleMeadowBotanicalZone } from './noise';

const LEXICAL_THEMES: Array<{
  keywords: string[];
  profile: SemanticBloomProfile;
}> = [
  {
    keywords: [
      'sun', 'warm', 'warmth', 'summer', 'fire', 'flame', 'gold', 'golden',
      'amber', 'dawn', 'light', 'noon', 'solstice', 'radiance', 'glow', 'day', 'burn',
    ],
    profile: {
      driftName: 'SOLAR POPPY DRIFT',
      poppyRatio: 0.74,
      stemHeightRange: [0.85, 1.18],
      densityMultiplier: 1.05,
      palette: [
        ...BOTANICAL_SWATCHES.tangerine,
        ...BOTANICAL_SWATCHES.marigold,
      ],
    },
  },
  {
    keywords: [
      'love', 'rose', 'heart', 'crimson', 'red', 'passion', 'velvet', 'kiss',
      'desire', 'ruby', 'wine', 'devotion', 'tender', 'beloved', 'scarlet', 'blood',
    ],
    profile: {
      driftName: 'CRIMSON RANUNCULUS DRIFT',
      poppyRatio: 0.32,
      stemHeightRange: [0.75, 1.05],
      densityMultiplier: 1.15,
      palette: [
        ...BOTANICAL_SWATCHES.crimson,
        ...BOTANICAL_SWATCHES.rose,
      ],
    },
  },
  {
    keywords: [
      'quiet', 'wind', 'breeze', 'mist', 'silence', 'peace', 'breath', 'cloud',
      'ivory', 'pale', 'snow', 'whisper', 'air', 'calm', 'hush', 'still', 'ghost', 'moon',
    ],
    profile: {
      driftName: 'ZEPHYR IVORY DRIFT',
      poppyRatio: 0.82,
      stemHeightRange: [0.92, 1.24],
      densityMultiplier: 0.95,
      palette: [
        ...BOTANICAL_SWATCHES.ivory,
        BOTANICAL_SWATCHES.marigold[1],
        BOTANICAL_SWATCHES.marigold[2],
      ],
    },
  },
  {
    keywords: [
      'night', 'dusk', 'star', 'stars', 'dream', 'shadow', 'twilight',
      'evening', 'sleep', 'vesper', 'midnight', 'nocturne',
    ],
    profile: {
      driftName: 'VESPER ROSE & IVORY DRIFT',
      poppyRatio: 0.56,
      stemHeightRange: [0.82, 1.12],
      densityMultiplier: 1.02,
      palette: [
        BOTANICAL_SWATCHES.crimson[2],
        BOTANICAL_SWATCHES.crimson[3],
        ...BOTANICAL_SWATCHES.rose,
        BOTANICAL_SWATCHES.ivory[0],
      ],
    },
  },
  {
    keywords: [
      'meadow', 'field', 'earth', 'spring', 'flora', 'garden', 'seed', 'rain',
      'valley', 'hill', 'bloom', 'wild', 'blossom', 'petal', 'pastoral', 'life',
    ],
    profile: {
      driftName: 'PASTORAL MEADOW TAPESTRY',
      poppyRatio: 0.58,
      stemHeightRange: [0.82, 1.15],
      densityMultiplier: 1.08,
      palette: [
        BOTANICAL_SWATCHES.tangerine[0],
        BOTANICAL_SWATCHES.tangerine[2],
        BOTANICAL_SWATCHES.crimson[1],
        BOTANICAL_SWATCHES.rose[0],
        BOTANICAL_SWATCHES.marigold[1],
        BOTANICAL_SWATCHES.ivory[0],
      ],
    },
  },
];

/**
 * Analyzes semantic keywords and vowel/consonant phonetic texture to select
 * a botanical bloom drift profile.
 */
export function analyzePhraseBotany(rawPhrase: string): SemanticBloomProfile {
  const cleaned = rawPhrase.toLowerCase().trim();
  const tokens = cleaned.split(/[^a-z]+/).filter(Boolean);

  for (const entry of LEXICAL_THEMES) {
    for (const token of tokens) {
      if (entry.keywords.some((kw) => token === kw || (token.length >= 4 && token.startsWith(kw)))) {
        return entry.profile;
      }
    }
  }

  // Phonetic vowel / consonant density fallback
  const letters = cleaned.replace(/[^a-z]/g, '');
  const vowelCount = (letters.match(/[aeiouy]/g) || []).length;
  const vowelRatio = letters.length > 0 ? vowelCount / letters.length : 0.42;

  if (vowelRatio >= 0.47) {
    // High vowel resonance -> airy ivory, buttercup, and soft blush poppies
    return {
      driftName: 'AIRY BUTTERCUP & IVORY DRIFT',
      poppyRatio: 0.76,
      stemHeightRange: [0.90, 1.20],
      densityMultiplier: 0.98,
      palette: [
        ...BOTANICAL_SWATCHES.ivory,
        ...BOTANICAL_SWATCHES.marigold,
        BOTANICAL_SWATCHES.rose[1],
      ],
    };
  }

  if (vowelRatio < 0.34) {
    // Crisp consonant clusters -> dense crimson, berry, and burnt tangerine ranunculus
    return {
      driftName: 'VELVET CARMINE & TANGERINE DRIFT',
      poppyRatio: 0.38,
      stemHeightRange: [0.76, 1.06],
      densityMultiplier: 1.12,
      palette: [
        ...BOTANICAL_SWATCHES.crimson,
        BOTANICAL_SWATCHES.tangerine[0],
        BOTANICAL_SWATCHES.tangerine[1],
      ],
    };
  }

  // Balanced lyric cadence -> sun-drenched Tuscan poppy & marigold drift
  return {
    driftName: 'SUNLIT TANGERINE & ROSE DRIFT',
    poppyRatio: 0.60,
    stemHeightRange: [0.84, 1.15],
    densityMultiplier: 1.04,
    palette: [
      ...BOTANICAL_SWATCHES.tangerine,
      BOTANICAL_SWATCHES.crimson[1],
      BOTANICAL_SWATCHES.rose[0],
      BOTANICAL_SWATCHES.marigold[0],
    ],
  };
}

let sharedOffscreenCanvas: HTMLCanvasElement | null = null;

function getOffscreenTextCanvas(): HTMLCanvasElement {
  if (!sharedOffscreenCanvas) {
    sharedOffscreenCanvas = document.createElement('canvas');
    sharedOffscreenCanvas.width = 1024;
    sharedOffscreenCanvas.height = 280;
  }
  return sharedOffscreenCanvas;
}

export interface MeadowProjectionFrame {
  /** World XZ center of the focal stage right ahead of the camera */
  centerXZ: THREE.Vector2;
  /** Unit right vector on XZ plane */
  rightXZ: THREE.Vector2;
  /** Unit forward (away from camera) vector on XZ plane */
  forwardXZ: THREE.Vector2;
}

/**
 * Rasterizes typed text onto an offscreen 2D canvas, samples glyph stroke coordinates
 * with organic botanical jitter + perspective depth compensation, and maps them onto
 * the 3D wildflower meadow terrain.
 */
export function rasterizePhraseToMeadow(
  rawText: string,
  frame: MeadowProjectionFrame
): { profile: SemanticBloomProfile; points: SampledBloomPoint[] } {
  const text = rawText.trim().replace(/\s+/g, ' ').slice(0, 30);
  const profile = analyzePhraseBotany(text);
  if (!text) {
    return { profile, points: [] };
  }

  const canvas = getOffscreenTextCanvas();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { profile, points: [] };
  }

  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Dynamically size editorial serif so short words have stately poise and longer phrases fit cleanly
  let fontSize = 154;
  ctx.font = `600 ${fontSize}px "Cormorant Garamond", Georgia, serif`;
  let measured = ctx.measureText(text).width;
  while (measured > W * 0.86 && fontSize > 54) {
    fontSize -= 6;
    ctx.font = `600 ${fontSize}px "Cormorant Garamond", Georgia, serif`;
    measured = ctx.measureText(text).width;
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W * 0.5, H * 0.52);

  const img = ctx.getImageData(0, 0, W, H).data;

  // Find tight active glyph bounding box
  let minX = W;
  let maxX = 0;
  let minY = H;
  let maxY = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const a = img[(y * W + x) * 4 + 3];
      if (a > 90) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    return { profile, points: [] };
  }

  const glyphW = Math.max(1, maxX - minX);
  const glyphH = Math.max(1, maxY - minY);

  // Collect stroke candidates with sub-grid jitter
  const rawCandidates: Array<{ nx: number; ny: number; orderX: number }> = [];
  const step = Math.max(4, Math.round(7 / Math.sqrt(profile.densityMultiplier)));

  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      const jx = Math.min(W - 1, Math.max(0, Math.round(x + (Math.random() - 0.5) * step * 0.7)));
      const jy = Math.min(H - 1, Math.max(0, Math.round(y + (Math.random() - 0.5) * step * 0.7)));
      const alpha = img[(jy * W + jx) * 4 + 3];
      if (alpha > 105) {
        // nx in [-0.5 .. +0.5] left-to-right; ny in [0 .. 1] bottom-to-top!
        const nx = (jx - (minX + maxX) * 0.5) / W;
        const ny = 1.0 - (jy - minY) / glyphH;
        const orderX = (jx - minX) / glyphW;
        rawCandidates.push({ nx, ny, orderX });
      }
    }
  }

  // Target 145..240 rich blossoms per phrase so strokes look lush, legible, and fast
  const targetCount = Math.min(
    245,
    Math.max(95, Math.round((95 + text.length * 14) * profile.densityMultiplier))
  );

  // Stratified downsample if rawCandidates exceeds targetCount
  let selected = rawCandidates;
  if (rawCandidates.length > targetCount) {
    // Shuffle slightly then pick evenly across stroke order
    for (let i = rawCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = rawCandidates[i];
      rawCandidates[i] = rawCandidates[j];
      rawCandidates[j] = tmp;
    }
    selected = rawCandidates.slice(0, targetCount);
  }

  // Sort sequentially along the writing path (left-to-right + subtle bottom-to-top)
  selected.sort((a, b) => a.orderX + a.ny * 0.08 - (b.orderX + b.ny * 0.08));

  // World-space span on the focal meadow plane:
  // Width scales naturally with word length (up to ~13.4m); depth stretches ~4.3m
  // along camera forward so low cinematic camera foreshortening reveals crisp letterforms!
  const aspectSpanWidth = Math.min(13.6, Math.max(5.8, (glyphW / W) * 14.8));
  const foreshortenedDepthSpan = Math.min(4.8, Math.max(3.2, (glyphH / H) * 7.8));

  // Slight organic drift offset per submission so repeated words weave slightly across the focal pocket
  const driftOffsetRight = (Math.random() - 0.5) * 0.9;
  const driftOffsetForward = (Math.random() - 0.5) * 0.7;

  const points: SampledBloomPoint[] = [];
  const palette = profile.palette;

  for (let i = 0; i < selected.length; i++) {
    const c = selected[i];
    // Crisp yet natural botanical stroke jitter so letters read clearly as living floral drifts
    const jitterRight = (Math.random() - 0.5) * 0.16;
    const jitterForward = (Math.random() - 0.5) * 0.22;

    const localRight = (c.nx / Math.max(0.18, glyphW / W)) * aspectSpanWidth + jitterRight + driftOffsetRight;
    const localForward = (c.ny - 0.45) * foreshortenedDepthSpan + jitterForward + driftOffsetForward;

    const worldX =
      frame.centerXZ.x +
      frame.rightXZ.x * localRight +
      frame.forwardXZ.x * localForward;
    const worldZ =
      frame.centerXZ.y +
      frame.rightXZ.y * localRight +
      frame.forwardXZ.y * localForward;

    // Color glides smoothly across the palette along the phrase with natural local variation
    const palFloat = (c.orderX * (palette.length - 1)) + (Math.random() - 0.5) * 0.85;
    const palIdx = Math.max(0, Math.min(palette.length - 1, Math.round(palFloat)));
    const swatch: BotanicalColorPair = palette[palIdx];

    const species = Math.random() < profile.poppyRatio ? 'poppy' : 'ranunculus';

    points.push({
      x: worldX,
      z: worldZ,
      strokeProgress: c.orderX,
      glyphHeightRatio: c.ny,
      species,
      primaryHex: swatch.primary,
      secondaryHex: swatch.secondary,
      scale: 0.96 + Math.random() * 0.28,
    });

    // 18% chance of a smaller satellite companion bud/blossom slightly outside the stroke
    // so thebloomed phrase blends effortlessly into the surrounding meadow
    if (Math.random() < 0.18) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 0.28 + Math.random() * 0.45;
      points.push({
        x: worldX + Math.cos(ang) * dist,
        z: worldZ + Math.sin(ang) * dist,
        strokeProgress: Math.min(1.0, c.orderX + 0.08 + Math.random() * 0.08),
        glyphHeightRatio: c.ny * 0.85,
        species: Math.random() < profile.poppyRatio ? 'poppy' : 'ranunculus',
        primaryHex: swatch.primary,
        secondaryHex: swatch.secondary,
        scale: 0.74 + Math.random() * 0.22,
      });
    }
  }

  return { profile, points };
}

/**
 * Generates a natural small wildflower cluster for Click-to-Sow directly at a
 * clicked terrain coordinate.
 */
export function createClickClusterPoints(worldX: number, worldZ: number): SampledBloomPoint[] {
  const count = 7 + Math.floor(Math.random() * 4);
  const points: SampledBloomPoint[] = [];
  const baseZone = sampleMeadowBotanicalZone(worldX, worldZ, Math.random());

  for (let i = 0; i < count; i++) {
    const r = i === 0 ? 0.04 : 0.14 + Math.pow(Math.random(), 0.75) * 0.58;
    const ang = (i / count) * Math.PI * 2.0 + (Math.random() - 0.5) * 0.65;
    const px = worldX + Math.cos(ang) * r;
    const pz = worldZ + Math.sin(ang) * r;

    const localSample = i % 3 === 0
      ? sampleMeadowBotanicalZone(px, pz, Math.random())
      : baseZone;

    points.push({
      x: px,
      z: pz,
      strokeProgress: i / count,
      glyphHeightRatio: 0.45 + (1.0 - r) * 0.4,
      species: i % 2 === 0 ? localSample.species : (localSample.species === 'poppy' ? 'ranunculus' : 'poppy'),
      primaryHex: localSample.color.primary,
      secondaryHex: localSample.color.secondary,
      scale: i === 0 ? 1.12 : 0.82 + Math.random() * 0.34,
    });
  }

  return points;
}
