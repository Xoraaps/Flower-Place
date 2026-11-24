import * as THREE from 'three';

/**
 * Vertex attributes shared by both Wild Poppy & Ranunculus geometries:
 * - position (vec3)
 * - normal (vec3)
 * - aPart (float): 0.0 = stem/calyx, 1.0 = dark seed-pod/stamen heart, 2.0 = petal
 * - aPetalUV (vec2): x = u (-1..1 across petal), y = v (0..1 from base to tip, or stem height 0..1)
 * - aBotanicalMeta (vec3): x = ringRatio (0 inner .. 1 outer), y = bakedAO (0..1), z = petalIndexSeed
 */

interface GeometryBuffers {
  positions: number[];
  normals: number[];
  parts: number[];
  petalUVs: number[];
  meta: number[];
  indices: number[];
}

function createEmptyBuffers(): GeometryBuffers {
  return {
    positions: [],
    normals: [],
    parts: [],
    petalUVs: [],
    meta: [],
    indices: [],
  };
}

function finalizeBotanicalGeometry(b: GeometryBuffers): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(b.parts, 1));
  geo.setAttribute('aPetalUV', new THREE.Float32BufferAttribute(b.petalUVs, 2));
  geo.setAttribute('aBotanicalMeta', new THREE.Float32BufferAttribute(b.meta, 3));
  geo.setIndex(b.indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Appends a slender sinuous cylindrical stem from y = 0 up to y = 1.0.
 * Returns the exact apex position (x, 1.0, z) where the flower head attaches.
 */
function appendSinuousStem(
  b: GeometryBuffers,
  baseRadius: number,
  topRadius: number,
  curveAmpX: number,
  curveAmpZ: number,
  radialSegs = 5,
  heightSegs = 7
): THREE.Vector3 {
  const baseVertexOffset = b.positions.length / 3;

  const getCenter = (t: number) => {
    const cx = Math.sin(t * Math.PI * 1.15) * curveAmpX;
    const cz = (1.0 - Math.cos(t * Math.PI * 0.85)) * curveAmpZ;
    return new THREE.Vector3(cx, t, cz);
  };

  for (let j = 0; j <= heightSegs; j++) {
    const t = j / heightSegs;
    const center = getCenter(t);
    const radius = baseRadius * (1.0 - t) + topRadius * t;

    for (let i = 0; i < radialSegs; i++) {
      const ang = (i / radialSegs) * Math.PI * 2.0;
      const nx = Math.cos(ang);
      const nz = Math.sin(ang);

      b.positions.push(center.x + nx * radius, center.y, center.z + nz * radius);
      b.normals.push(nx, 0.12, nz);
      b.parts.push(0.0); // stem
      b.petalUVs.push(0.0, t);
      b.meta.push(0.0, 0.45 + 0.55 * t, 0.0);
    }
  }

  for (let j = 0; j < heightSegs; j++) {
    for (let i = 0; i < radialSegs; i++) {
      const nextI = (i + 1) % radialSegs;
      const r0 = baseVertexOffset + j * radialSegs + i;
      const r1 = baseVertexOffset + j * radialSegs + nextI;
      const r2 = baseVertexOffset + (j + 1) * radialSegs + i;
      const r3 = baseVertexOffset + (j + 1) * radialSegs + nextI;
      b.indices.push(r0, r2, r1, r1, r2, r3);
    }
  }

  // Small green receptacle/calyx flare right at the stem apex
  const apex = getCenter(1.0);
  const calyxBase = b.positions.length / 3;
  const calyxSegs = 6;
  b.positions.push(apex.x, apex.y - 0.008, apex.z);
  b.normals.push(0, -1, 0);
  b.parts.push(0.0);
  b.petalUVs.push(0.0, 1.0);
  b.meta.push(0.0, 0.55, 0.0);

  for (let i = 0; i < calyxSegs; i++) {
    const ang = (i / calyxSegs) * Math.PI * 2.0;
    const cr = topRadius * 3.4;
    b.positions.push(apex.x + Math.cos(ang) * cr, apex.y + 0.008, apex.z + Math.sin(ang) * cr);
    b.normals.push(Math.cos(ang) * 0.7, -0.5, Math.sin(ang) * 0.7);
    b.parts.push(0.0);
    b.petalUVs.push(0.0, 1.0);
    b.meta.push(0.0, 0.72, 0.0);
  }

  for (let i = 0; i < calyxSegs; i++) {
    const nextI = (i + 1) % calyxSegs;
    b.indices.push(calyxBase, calyxBase + 1 + nextI, calyxBase + 1 + i);
  }

  return apex;
}

/**
 * 1. PAPERY WILD POPPY (Papaver rhoeas)
 * Slender tall stem + dark charcoal seed-pod & stamen crown + 5 wide crinkled
 * cupped papery petals that glow warmly with backlit subsurface translucency.
 */
export function createWildPoppyGeometry(): THREE.BufferGeometry {
  const b = createEmptyBuffers();
  const apex = appendSinuousStem(b, 0.0052, 0.0034, 0.028, 0.024, 5, 7);

  // Dark fluted poppy seed-pod capsule + anther crown at flower heart (aPart = 1.0)
  const podSegs = 8;
  const podRings = 3;
  const podStart = b.positions.length / 3;
  const podRadius = 0.020;
  const podHeight = 0.030;

  for (let r = 0; r <= podRings; r++) {
    const v = r / podRings;
    const profile = Math.sin(v * Math.PI * 0.88) * podRadius + 0.003;
    const py = apex.y + 0.004 + v * podHeight;
    for (let s = 0; s < podSegs; s++) {
      const ang = (s / podSegs) * Math.PI * 2.0;
      const flute = 1.0 + 0.10 * Math.cos(ang * 8.0);
      const nx = Math.cos(ang);
      const nz = Math.sin(ang);
      b.positions.push(apex.x + nx * profile * flute, py, apex.z + nz * profile * flute);
      b.normals.push(nx * 0.7, 0.4 + v * 0.5, nz * 0.7);
      b.parts.push(1.0); // dark poppy center pod
      b.petalUVs.push(0.0, v);
      b.meta.push(0.0, 0.4 + 0.5 * v, 0.0);
    }
  }
  for (let r = 0; r < podRings; r++) {
    for (let s = 0; s < podSegs; s++) {
      const ns = (s + 1) % podSegs;
      const i0 = podStart + r * podSegs + s;
      const i1 = podStart + r * podSegs + ns;
      const i2 = podStart + (r + 1) * podSegs + s;
      const i3 = podStart + (r + 1) * podSegs + ns;
      b.indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  // 5 overlapping cupped crinkled papery petals (aPart = 2.0)
  const petalCount = 5;
  const uSteps = 6; // across width
  const vSteps = 5; // base to outer crinkled margin

  for (let p = 0; p < petalCount; p++) {
    const baseYaw = (p / petalCount) * Math.PI * 2.0 + (p % 2) * 0.14;
    const ringTier = p < 2 ? 0.0 : 1.0; // inner pair slightly tighter than outer 3 to prevent z-fighting
    const petalStart = b.positions.length / 3;
    const pSeed = (p + 1) * 0.19;

    const cosY = Math.cos(baseYaw);
    const sinY = Math.sin(baseYaw);

    // Deeper cupped poppy goblet profile matching real field poppies
    for (let iv = 0; iv <= vSteps; iv++) {
      const v = iv / vSteps; // 0 = base, 1 = crinkled rim

      // Delicate goblet reach & steeper translucent cup walls
      const radialReach = (0.009 + Math.pow(v, 0.86) * (0.082 + ringTier * 0.009));
      const cupLift = Math.pow(v, 0.56) * (0.086 - ringTier * 0.009) - Math.pow(v, 2.8) * 0.012;
      const halfWidth = 0.009 + Math.sin(Math.pow(v, 0.56) * Math.PI * 0.86) * 0.078;

      for (let iu = 0; iu <= uSteps; iu++) {
        const u = (iu / uSteps) * 2.0 - 1.0; // -1 .. +1

        // Lateral cupping curvature + authentic tissue-paper radial crinkle pleats
        const lateralCup = (1.0 - u * u) * 0.016 * v;
        const crinkle =
          Math.sin(u * 8.5 + pSeed * 12.0) * 0.0048 * v +
          Math.cos(u * 15.0 - pSeed * 7.0) * 0.0024 * v * v;
        const rimScallop = 1.0 + 0.055 * Math.cos(u * 6.0 + pSeed * 5.0) * v;

        // Local petal space: +Z is radial outward, X is tangential width, Y is upward cup
        const lx = u * halfWidth;
        const lz = (radialReach * rimScallop - (u * u) * 0.014 * v);
        const ly = cupLift + lateralCup + crinkle;

        // Rotate around stem apex by baseYaw + natural poppy cup tilt (~20 deg)
        const wx = lx * cosY + lz * sinY;
        const wz = -lx * sinY + lz * cosY;
        const nodAngle = 0.34;
        const cosN = Math.cos(nodAngle);
        const sinN = Math.sin(nodAngle);
        const finalY = ly * cosN - wz * sinN;
        const finalZ = ly * sinN + wz * cosN;

        b.positions.push(apex.x + wx, apex.y + 0.006 + finalY, apex.z + finalZ);

        // Smooth cupped bowl normal + subtle radial pleat normal ripple for silky sheen
        const pleatNx = Math.cos(u * 8.5 + pSeed * 12.0) * 0.16 * v;
        const localNorm = new THREE.Vector3(
          -u * 0.35 + pleatNx,
          0.78 - v * 0.25,
          -0.42 - v * 0.22
        ).normalize();

        const rnx = localNorm.x * cosY + localNorm.z * sinY;
        const rnz = -localNorm.x * sinY + localNorm.z * cosY;
        const fnY = localNorm.y * cosN - rnz * sinN;
        const fnZ = localNorm.y * sinN + rnz * cosN;

        b.normals.push(rnx, fnY, fnZ);
        b.parts.push(2.0); // papery petal
        b.petalUVs.push(u, v);
        // Inner throat of poppy has rich dark-velvet AO; outer rim is luminous 1.0
        const ao = 0.42 + 0.58 * Math.pow(v, 0.55);
        b.meta.push(0.55 + ringTier * 0.45, ao, pSeed);
      }
    }

    const row = uSteps + 1;
    for (let iv = 0; iv < vSteps; iv++) {
      for (let iu = 0; iu < uSteps; iu++) {
        const a = petalStart + iv * row + iu;
        const c = a + 1;
        const d = petalStart + (iv + 1) * row + iu;
        const e = d + 1;
        b.indices.push(a, d, c, c, d, e);
      }
    }
  }

  return finalizeBotanicalGeometry(b);
}

/**
 * 2. DENSE RANUNCULUS CLUSTER HEAD (Ranunculus asiaticus)
 * Lush, tightly packed multi-layered ruffled rosette with 22 cupped petals
 * arranged across 4 concentric Fibonacci/whorl rings + leafy stem accents.
 */
export function createRanunculusGeometry(): THREE.BufferGeometry {
  const b = createEmptyBuffers();
  const apex = appendSinuousStem(b, 0.0062, 0.0044, 0.020, 0.018, 5, 6);

  // Add 2 small stem bract leaves partway up the ranunculus stalk for lush volume
  for (let lf = 0; lf < 2; lf++) {
    const leafY = 0.42 + lf * 0.24;
    const yaw = lf * 2.4 + 0.7;
    const leafBase = b.positions.length / 3;
    const cY = Math.cos(yaw);
    const sY = Math.sin(yaw);

    const pts = [
      [0.0, 0.0, 0.004],
      [-0.018, 0.045, 0.038],
      [0.018, 0.045, 0.038],
      [0.0, 0.095, 0.072],
    ];
    for (let k = 0; k < pts.length; k++) {
      const [lx, ly, lz] = pts[k];
      b.positions.push(lx * cY + lz * sY, leafY + ly, -lx * sY + lz * cY);
      b.normals.push(0.2 * sY, 0.85, 0.2 * cY);
      b.parts.push(0.0);
      b.petalUVs.push(0.0, leafY + ly * 0.5);
      b.meta.push(0.0, 0.72, 0.0);
    }
    b.indices.push(leafBase, leafBase + 1, leafBase + 2);
    b.indices.push(leafBase + 1, leafBase + 3, leafBase + 2);
  }

  // Tightly curled dark-green/burgundy center bud core (aPart = 1.0)
  const coreStart = b.positions.length / 3;
  const coreSegs = 6;
  b.positions.push(apex.x, apex.y + 0.028, apex.z);
  b.normals.push(0, 1, 0);
  b.parts.push(1.0);
  b.petalUVs.push(0, 0.5);
  b.meta.push(0.0, 0.35, 0.0);

  for (let i = 0; i < coreSegs; i++) {
    const ang = (i / coreSegs) * Math.PI * 2.0;
    b.positions.push(apex.x + Math.cos(ang) * 0.014, apex.y + 0.008, apex.z + Math.sin(ang) * 0.014);
    b.normals.push(Math.cos(ang) * 0.5, 0.85, Math.sin(ang) * 0.5);
    b.parts.push(1.0);
    b.petalUVs.push(0, 0.2);
    b.meta.push(0.0, 0.30, 0.0);
  }
  for (let i = 0; i < coreSegs; i++) {
    b.indices.push(coreStart, coreStart + 1 + i, coreStart + 1 + ((i + 1) % coreSegs));
  }

  // 4 concentric rings of tightly cupped ruffled ranunculus petals (22 petals total)
  const rings = [
    { count: 4, radiusReach: 0.036, cupHeight: 0.056, width: 0.030, ringRatio: 0.12, baseOffset: 0.010 },
    { count: 5, radiusReach: 0.058, cupHeight: 0.064, width: 0.046, ringRatio: 0.38, baseOffset: 0.008 },
    { count: 6, radiusReach: 0.082, cupHeight: 0.066, width: 0.062, ringRatio: 0.68, baseOffset: 0.005 },
    { count: 7, radiusReach: 0.106, cupHeight: 0.058, width: 0.074, ringRatio: 1.00, baseOffset: 0.002 },
  ];

  const uSteps = 4;
  const vSteps = 4;
  let globalPetalIdx = 0;

  for (let rIdx = 0; rIdx < rings.length; rIdx++) {
    const ring = rings[rIdx];
    const goldenOffset = rIdx * 1.12;

    for (let p = 0; p < ring.count; p++) {
      globalPetalIdx++;
      const yaw = (p / ring.count) * Math.PI * 2.0 + goldenOffset;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const pStart = b.positions.length / 3;
      const pSeed = (globalPetalIdx * 0.137) % 1.0;

      for (let iv = 0; iv <= vSteps; iv++) {
        const v = iv / vSteps;
        // Strongly incurved globular ranunculus cup shape!
        const rOut = 0.008 + Math.sin(v * Math.PI * 0.64) * ring.radiusReach;
        const yUp = ring.baseOffset + Math.pow(v, 0.72) * ring.cupHeight;
        const hw = 0.008 + Math.sin(Math.pow(v, 0.6) * Math.PI * 0.88) * ring.width;

        for (let iu = 0; iu <= uSteps; iu++) {
          const u = (iu / uSteps) * 2.0 - 1.0;
          // Tightly cupped edges + ruffled top wave
          const scoopZ = -(u * u) * 0.018 * v;
          const ruffle = Math.sin(u * 6.5 + pSeed * 9.0) * 0.0045 * v * v;

          const lx = u * hw;
          const lz = rOut + scoopZ + ruffle;
          const ly = yUp + (1.0 - u * u) * 0.008 * v;

          const wx = lx * cosY + lz * sinY;
          const wz = -lx * sinY + lz * cosY;

          // Subtle forward tilt so ruffled concentric layers face camera richly
          const nod = 0.18;
          const cN = Math.cos(nod);
          const sN = Math.sin(nod);
          const fy = ly * cN - wz * sN;
          const fz = ly * sN + wz * cN;

          b.positions.push(apex.x + wx, apex.y + fy, apex.z + fz);

          const ln = new THREE.Vector3(-u * 0.42, 0.68 - v * 0.15, 0.35 * ring.ringRatio - 0.25).normalize();
          const rnx = ln.x * cosY + ln.z * sinY;
          const rnz = -ln.x * sinY + ln.z * cosY;
          b.normals.push(rnx, ln.y * cN - rnz * sN, ln.y * sN + rnz * cN);

          b.parts.push(2.0);
          b.petalUVs.push(u, v);
          // Rich self-shadowing tucked between concentric ranunculus petal layers
          const layerAO = (0.34 + 0.44 * ring.ringRatio) * (0.55 + 0.45 * v) + 0.22 * v;
          b.meta.push(ring.ringRatio, Math.min(1.0, layerAO), pSeed);
        }
      }

      const row = uSteps + 1;
      for (let iv = 0; iv < vSteps; iv++) {
        for (let iu = 0; iu < uSteps; iu++) {
          const a = pStart + iv * row + iu;
          const c = a + 1;
          const d = pStart + (iv + 1) * row + iu;
          const e = d + 1;
          b.indices.push(a, d, c, c, d, e);
        }
      }
    }
  }

  return finalizeBotanicalGeometry(b);
}

/**
 * 3. NODDING UNOPENED WILD POPPY BUD
 * Scattered amidst the grass canopy just like the round olive-sage unopened
 * flower buds visible throughout the reference photograph.
 */
export function createPoppyBudGeometry(): THREE.BufferGeometry {
  const b = createEmptyBuffers();
  // Characteristic hooked/nodding poppy bud neck
  const apex = appendSinuousStem(b, 0.0042, 0.0028, 0.022, 0.045, 4, 6);

  const budStart = b.positions.length / 3;
  const segs = 6;
  const rings = 4;
  const budLen = 0.038;
  const budRad = 0.015;

  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const rad = Math.sin(v * Math.PI) * budRad + 0.0015;
    // Droops gently forward/downward like an unopened Papaver bud
    const localY = v * budLen * 0.72;
    const localZ = v * budLen * 0.58;

    for (let s = 0; s < segs; s++) {
      const ang = (s / segs) * Math.PI * 2.0;
      const nx = Math.cos(ang);
      const nz = Math.sin(ang);
      b.positions.push(apex.x + nx * rad, apex.y + localY - 0.004, apex.z + localZ + nz * rad * 0.85);
      b.normals.push(nx * 0.8, 0.35 + (v - 0.5) * 0.5, nz * 0.8);
      b.parts.push(0.0); // olive-sage sepal bud
      b.petalUVs.push(0.0, 0.82 + v * 0.18);
      b.meta.push(0.0, 0.68 + 0.32 * v, 0.0);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const ns = (s + 1) % segs;
      const i0 = budStart + r * segs + s;
      const i1 = budStart + r * segs + ns;
      const i2 = budStart + (r + 1) * segs + s;
      const i3 = budStart + (r + 1) * segs + ns;
      b.indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  return finalizeBotanicalGeometry(b);
}
