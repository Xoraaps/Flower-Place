import * as THREE from 'three';
import {
  GLSL_ATMOSPHERE_FOG,
  GLSL_BRUSH_SAMPLER,
  GLSL_MEADOW_WIND,
  GLSL_SIMPLEX_2D,
} from './glslCommon';
import { getTerrainHeight, getTerrainNormal } from './noise';

export interface SharedMeadowUniforms {
  uTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSunIntensity: { value: number };
  uSkyLightColor: { value: THREE.Color };
  uGroundBounceColor: { value: THREE.Color };
  uAmbientIntensity: { value: number };
  uFogColor: { value: THREE.Color };
  uSunGlowFogColor: { value: THREE.Color };
  uFogDensity: { value: number };
  uWindStrength: { value: number };
  uTranslucency: { value: number };
  uDewiness: { value: number };
  uNightFactor: { value: number };
  uSkyZenith: { value: THREE.Color };
  uSkyMid: { value: THREE.Color };
  uSkyHorizon: { value: THREE.Color };
  uBrushMap: { value: THREE.DataTexture };
  uBrushBounds: { value: THREE.Vector4 };
}

export function createSkyDome(uniforms: SharedMeadowUniforms): THREE.Mesh {
  const geo = new THREE.SphereGeometry(190, 48, 32);

  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: uniforms.uTime,
      uSunDir: uniforms.uSunDir,
      uSunColor: uniforms.uSunColor,
      uSkyZenith: uniforms.uSkyZenith,
      uSkyMid: uniforms.uSkyMid,
      uSkyHorizon: uniforms.uSkyHorizon,
      uSunGlowFogColor: uniforms.uSunGlowFogColor,
      uNightFactor: uniforms.uNightFactor,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_SIMPLEX_2D}

      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyZenith;
      uniform vec3 uSkyMid;
      uniform vec3 uSkyHorizon;
      uniform vec3 uSunGlowFogColor;
      uniform float uNightFactor;

      varying vec3 vWorldDir;

      // Deterministic star hash on spherical grid
      float hash21(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float elev = clamp(dir.y, -0.15, 1.0);

        // Smooth 3-stop atmospheric sky gradient
        float lowerMix = smoothstep(-0.04, 0.24, elev);
        float upperMix = smoothstep(0.18, 0.78, elev);
        vec3 sky = mix(uSkyHorizon, uSkyMid, lowerMix);
        sky = mix(sky, uSkyZenith, upperMix);

        vec3 sunDir = normalize(uSunDir);
        float sunCos = max(dot(dir, sunDir), 0.0);

        // Atmospheric solar Mie scattering aureole + soft disc (day/twilight)
        float dayWeight = 1.0 - smoothstep(0.35, 0.92, uNightFactor);
        float wideGlow = pow(sunCos, 4.2) * 0.16 * dayWeight;
        float aureole  = pow(sunCos, 34.0) * 0.24 * dayWeight;
        float sunDisc  = smoothstep(0.9988, 0.9996, sunCos) * 0.85 * dayWeight;

        // Horizon warm haze belt
        float horizonBelt = exp(-abs(dir.y + 0.01) * 12.5);
        sky = mix(sky, mix(uSkyHorizon, uSunGlowFogColor, pow(sunCos, 2.2) * 0.45), horizonBelt * 0.48);
        sky += uSunGlowFogColor * wideGlow + uSunColor * (aureole + sunDisc);

        // Subtle high-altitude cirrus wisps
        if (dir.y > 0.02) {
          vec2 cloudUV = dir.xz / (dir.y + 0.16);
          float c1 = snoise(cloudUV * 0.55 + vec2(uTime * 0.006, -uTime * 0.003));
          float c2 = snoise(cloudUV * 1.35 - vec2(uTime * 0.009, uTime * 0.004));
          float cirrus = smoothstep(0.18, 0.85, c1 * 0.65 + c2 * 0.35);
          cirrus *= smoothstep(0.02, 0.22, dir.y) * (1.0 - smoothstep(0.55, 0.95, dir.y));
          vec3 cloudTint = mix(
            mix(uSkyHorizon, uSunGlowFogColor, 0.55) * 1.12,
            vec3(0.09, 0.13, 0.22),
            uNightFactor
          );
          sky = mix(sky, cloudTint, cirrus * (0.28 * (1.0 - uNightFactor * 0.65)));
        }

        // Nighttime starry sky dome + soft moonlight halo
        if (uNightFactor > 0.01 && dir.y > 0.01) {
          // Project sky hemisphere onto 2D star cells
          vec2 starUV = dir.xz / (dir.y + 0.38) * 95.0;
          vec2 cell = floor(starUV);
          vec2 f = fract(starUV) - 0.5;
          float rnd = hash21(cell);

          if (rnd > 0.962) {
            vec2 jitter = vec2(hash21(cell + 7.1), hash21(cell + 19.3)) - 0.5;
            float d = length(f - jitter * 0.65);
            float twinkle = 0.72 + 0.28 * sin(uTime * (1.4 + rnd * 3.2) + rnd * 40.0);
            float brightness = smoothstep(0.16, 0.015, d) * twinkle * smoothstep(0.02, 0.24, dir.y);
            // Subtle warm/cool stellar colour temperature variation
            vec3 starCol = mix(vec3(0.76, 0.86, 1.0), vec3(1.0, 0.93, 0.80), fract(rnd * 31.7));
            sky += starCol * brightness * uNightFactor * (rnd > 0.992 ? 1.35 : 0.65);
          }

          // Subtle silvery lunar glow around moon direction (uSunDir acts as moon dir at night)
          float moonCos = max(dot(dir, sunDir), 0.0);
          float moonHalo = pow(moonCos, 18.0) * 0.24 + pow(moonCos, 160.0) * 0.55;
          float moonDisc = smoothstep(0.9991, 0.99955, moonCos) * 1.15;
          sky += vec3(0.72, 0.83, 0.98) * (moonHalo + moonDisc) * uNightFactor;
        }

        gl_FragColor = vec4(max(sky, vec3(0.0)), 1.0);
      }
    `,
  });

  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  return dome;
}

export function createTerrainMesh(uniforms: SharedMeadowUniforms): THREE.Mesh {
  const size = 156;
  const segments = 180;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const normAttr = geo.attributes.normal as THREE.BufferAttribute;
  const tmpNorm = new THREE.Vector3();

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const y = getTerrainHeight(x, z);
    posAttr.setY(i, y);

    getTerrainNormal(x, z, tmpNorm);
    normAttr.setXYZ(i, tmpNorm.x, tmpNorm.y, tmpNorm.z);
  }
  posAttr.needsUpdate = true;
  normAttr.needsUpdate = true;
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uSunDir: uniforms.uSunDir,
      uSunColor: uniforms.uSunColor,
      uSunIntensity: uniforms.uSunIntensity,
      uSkyLightColor: uniforms.uSkyLightColor,
      uAmbientIntensity: uniforms.uAmbientIntensity,
      uFogColor: uniforms.uFogColor,
      uSunGlowFogColor: uniforms.uSunGlowFogColor,
      uFogDensity: uniforms.uFogDensity,
      uNightFactor: uniforms.uNightFactor,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_SIMPLEX_2D}
      ${GLSL_ATMOSPHERE_FOG}

      uniform float uTime;
      uniform vec3 uSunColor;
      uniform float uSunIntensity;
      uniform vec3 uSkyLightColor;
      uniform float uAmbientIntensity;
      uniform float uNightFactor;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vec2 xz = vWorldPos.xz;
        float distFromCam = length(vWorldPos - cameraPosition);

        // Rich multi-tone meadow earth & olive moss base tucked beneath the grass canopy
        float patch1 = snoise(xz * 0.085) * 0.5 + 0.5;
        float patch2 = snoise(xz * 0.28 + vec2(4.2, -1.9)) * 0.5 + 0.5;

        vec3 deepLoam   = vec3(0.085, 0.105, 0.042);
        vec3 oliveBed   = vec3(0.185, 0.225, 0.082);
        vec3 sunlitSage = vec3(0.285, 0.315, 0.125);

        vec3 groundAlbedo = mix(deepLoam, oliveBed, patch1);
        groundAlbedo = mix(groundAlbedo, sunlitSage, patch2 * 0.55);

        // Beyond ~22m where individual grass blades taper off, blend in painterly
        // sweeping mid/far-field wildflower carpet tones so the horizon reads as
        // a continuous sea of crimson, tangerine, and sage blooms (matching reference)
        float farCarpetBlend = smoothstep(18.0, 44.0, distFromCam) * (1.0 - smoothstep(52.0, 74.0, distFromCam));
        if (farCarpetBlend > 0.001) {
          float band = snoise(xz * vec2(0.038, 0.068) + vec2(0.5, 1.2));
          float speckle = snoise(xz * 0.45) * 0.5 + 0.5;
          vec3 farCrimson = vec3(0.46, 0.11, 0.14);
          vec3 farRose    = vec3(0.62, 0.31, 0.35);
          vec3 farOrange  = vec3(0.64, 0.25, 0.09);
          vec3 farMeadow  = vec3(0.26, 0.29, 0.13);

          vec3 floralDrift = mix(farOrange, farCrimson, smoothstep(-0.15, 0.35, band));
          floralDrift = mix(floralDrift, farRose, speckle * 0.42);
          groundAlbedo = mix(groundAlbedo, mix(farMeadow, floralDrift, 0.58), farCarpetBlend);
        }

        // Distant treeline olive-earth strip near horizon edge
        float treelineStrip = smoothstep(48.0, 66.0, distFromCam);
        groundAlbedo = mix(groundAlbedo, vec3(0.21, 0.23, 0.13), treelineStrip * 0.72);

        // Moving wind/cloud light dapple
        float cloudDapple = 0.82 + 0.18 * snoise(xz * 0.035 - vec2(uTime * 0.18, uTime * 0.09));

        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uSunDir);
        float ndl = max(dot(N, L), 0.0);

        vec3 directLight = uSunColor * (ndl * uSunIntensity * 0.68 * cloudDapple);
        vec3 hemiLight   = uSkyLightColor * uAmbientIntensity * 0.72;
        vec3 litColor    = groundAlbedo * (directLight + hemiLight);

        litColor = applyMeadowAerialPerspective(litColor, vWorldPos, cameraPosition);
        gl_FragColor = vec4(litColor, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'meadow-terrain';
  return mesh;
}

/**
 * Builds the distant hazy horizon hills and sparse Italian cypress spires +
 * wind-softened Mediterranean tree clusters silhouetted along the horizon,
 * directly honouring the composition of the visual reference.
 */
export function createHorizonLandscape(uniforms: SharedMeadowUniforms): THREE.Group {
  const group = new THREE.Group();
  group.name = 'horizon-landscape';

  const silhouetteMat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: uniforms.uSunDir,
      uSunColor: uniforms.uSunColor,
      uSunIntensity: uniforms.uSunIntensity,
      uSkyLightColor: uniforms.uSkyLightColor,
      uAmbientIntensity: uniforms.uAmbientIntensity,
      uFogColor: uniforms.uFogColor,
      uSunGlowFogColor: uniforms.uSunGlowFogColor,
      uFogDensity: uniforms.uFogDensity,
    },
    vertexShader: /* glsl */ `
      attribute vec3 aBaseTint;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vTint;

      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vTint = aBaseTint;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_ATMOSPHERE_FOG}
      uniform vec3 uSunColor;
      uniform float uSunIntensity;
      uniform vec3 uSkyLightColor;
      uniform float uAmbientIntensity;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vTint;

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uSunDir);
        float ndl = max(dot(N, L), 0.0) * 0.55 + 0.15;

        vec3 col = vTint * (uSunColor * ndl * uSunIntensity * 0.45 + uSkyLightColor * uAmbientIntensity * 0.85);

        // Extra distant aerial haze boost so horizon silhouettes stay painterly and soft
        vec3 toFrag = vWorldPos - cameraPosition;
        float dist = length(toFrag);
        vec3 hazed = applyMeadowAerialPerspective(col, vWorldPos, cameraPosition);
        float horizonSoftness = smoothstep(55.0, 118.0, dist) * 0.48;
        hazed = mix(hazed, uFogColor, horizonSoftness);

        gl_FragColor = vec4(hazed, 1.0);
      }
    `,
  });

  // 1. Two concentric panoramic hill rings (mid-ridge at R=84m, far mountain ridge at R=118m)
  const buildHillRing = (
    radius: number,
    baseHeight: number,
    amp: number,
    freq: number,
    phase: number,
    tintRGB: [number, number, number]
  ) => {
    const radialSegs = 160;
    const heightSegs = 6;
    const positions: number[] = [];
    const normals: number[] = [];
    const tints: number[] = [];
    const indices: number[] = [];

    for (let j = 0; j <= heightSegs; j++) {
      const v = j / heightSegs; // 0 = bottom skirt, 1 = ridge crest
      for (let i = 0; i <= radialSegs; i++) {
        const theta = (i / radialSegs) * Math.PI * 2;
        const x = Math.sin(theta) * radius;
        const z = -Math.cos(theta) * radius;

        // Gentle Tuscan valley ridge profile (taller on left-back & far horizon, softer on right)
        const ridgeProfile =
          baseHeight +
          Math.sin(theta * freq + phase) * amp * 0.55 +
          Math.cos(theta * (freq * 1.7) - phase * 0.6) * amp * 0.32 +
          Math.sin(theta * (freq * 3.1) + 1.4) * amp * 0.13;

        const yBottom = -4.0;
        const yTop = Math.max(0.5, ridgeProfile);
        const rOffset = (1.0 - v) * 6.0;
        const px = Math.sin(theta) * (radius + rOffset);
        const pz = -Math.cos(theta) * (radius + rOffset);
        const py = yBottom + (yTop - yBottom) * Math.pow(v, 0.78);

        positions.push(px, py, pz);
        normals.push(-Math.sin(theta) * 0.35, 0.92, Math.cos(theta) * 0.35);
        tints.push(tintRGB[0], tintRGB[1], tintRGB[2]);
      }
    }

    const row = radialSegs + 1;
    for (let j = 0; j < heightSegs; j++) {
      for (let i = 0; i < radialSegs; i++) {
        const a = j * row + i;
        const b = a + 1;
        const c = (j + 1) * row + i;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('aBaseTint', new THREE.Float32BufferAttribute(tints, 3));
    g.setIndex(indices);
    return new THREE.Mesh(g, silhouetteMat);
  };

  // Nearer valley ridge + farther blue-slate mountain range framing the horizon silhouettes
  group.add(buildHillRing(88, 6.4, 3.2, 2.0, 0.75, [0.20, 0.23, 0.18]));
  group.add(buildHillRing(120, 10.8, 4.8, 3.0, 2.15, [0.24, 0.29, 0.35]));

  // 2. Sparse Italian Cypress spires & Mediterranean oak/pine clusters along the distant ridge
  // Placed directly along the z ~ -62..-68m horizon to match the reference composition,
  // plus gentle companions around the wider valley.
  const treeParts: THREE.BufferGeometry[] = [];

  const pushTintedGeo = (geo: THREE.BufferGeometry, tint: [number, number, number]) => {
    const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
    const count = nonIndexed.attributes.position.count;
    const tintArr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      tintArr[i * 3] = tint[0];
      tintArr[i * 3 + 1] = tint[1];
      tintArr[i * 3 + 2] = tint[2];
    }
    nonIndexed.setAttribute('aBaseTint', new THREE.BufferAttribute(tintArr, 3));
    treeParts.push(nonIndexed);
  };

  const addCypress = (x: number, z: number, height: number, width: number) => {
    const baseY = getTerrainHeight(x, z) - 0.15;
    const cone = new THREE.ConeGeometry(width, height, 7, 4);
    const pos = cone.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      const normY = (py + height * 0.5) / height; // 0..1
      // Swell slightly in lower-middle like a real Cupressus sempervirens spire
      const swell = Math.sin(normY * Math.PI * 0.88) * 1.25 + 0.18;
      pos.setX(i, pos.getX(i) * swell);
      pos.setZ(i, pos.getZ(i) * swell);
    }
    cone.computeVertexNormals();
    cone.translate(x, baseY + height * 0.46, z);
    pushTintedGeo(cone, [0.11, 0.14, 0.09]);
  };

  const addCanopyTree = (x: number, z: number, height: number, crownRadius: number, seed: number) => {
    const baseY = getTerrainHeight(x, z) - 0.2;
    // Subtle trunk
    const trunk = new THREE.CylinderGeometry(crownRadius * 0.10, crownRadius * 0.16, height * 0.52, 5);
    trunk.translate(x, baseY + height * 0.24, z);
    pushTintedGeo(trunk, [0.14, 0.13, 0.10]);

    // 3 overlapping organic foliage puffs for wind-softened Mediterranean canopy silhouette
    for (let k = 0; k < 3; k++) {
      const ang = seed * 4.1 + k * 2.15;
      const rScale = crownRadius * (k === 0 ? 1.0 : 0.78);
      const puff = new THREE.IcosahedronGeometry(rScale, 1);
      puff.scale(1.22, 0.82 + (k % 2) * 0.14, 1.05);
      puff.translate(
        x + Math.cos(ang) * crownRadius * 0.36 * (k === 0 ? 0 : 1),
        baseY + height * (0.64 + k * 0.08),
        z + Math.sin(ang) * crownRadius * 0.28 * (k === 0 ? 0 : 1)
      );
      pushTintedGeo(puff, [0.13, 0.16, 0.10]);
    }
  };

  // Left-of-center cypress trio (signature visual anchor from the reference image)
  addCypress(-15.5, -62.0, 5.4, 0.52);
  addCypress(-13.6, -63.2, 3.8, 0.40);
  addCypress(-12.1, -62.6, 3.2, 0.36);

  // Right-of-center soft Mediterranean grove
  addCanopyTree(6.5, -63.5, 3.6, 1.55, 1.1);
  addCanopyTree(10.2, -64.2, 4.1, 1.85, 2.4);
  addCanopyTree(14.8, -63.0, 3.5, 1.45, 3.7);
  addCanopyTree(20.4, -64.8, 4.3, 1.95, 5.2);

  // Far-right taller twin holm-oak cluster (as seen on upper-right horizon of reference)
  addCanopyTree(34.5, -60.5, 5.8, 2.45, 6.8);
  addCanopyTree(38.2, -61.4, 5.2, 2.25, 8.1);
  addCanopyTree(29.8, -62.0, 2.6, 1.20, 9.3);

  // Subtle side/rear valley accents for 360-degree camera exploration
  addCypress(-36.0, -58.0, 4.8, 0.48);
  addCypress(-34.3, -58.8, 3.9, 0.40);
  addCanopyTree(-48.0, -45.0, 4.6, 2.1, 4.2);
  addCanopyTree(52.0, -42.0, 4.4, 1.9, 7.5);
  addCypress(44.0, 48.0, 4.6, 0.45);
  addCanopyTree(-38.0, 54.0, 4.5, 2.0, 2.9);

  // Merge all horizon tree buffers into one single draw call
  const mergedPos: number[] = [];
  const mergedNorm: number[] = [];
  const mergedTint: number[] = [];
  for (const part of treeParts) {
    const p = part.attributes.position.array as Float32Array;
    const n = part.attributes.normal.array as Float32Array;
    const t = part.attributes.aBaseTint.array as Float32Array;
    for (let i = 0; i < p.length; i++) {
      mergedPos.push(p[i]);
      mergedNorm.push(n[i]);
      mergedTint.push(t[i]);
    }
    part.dispose();
  }

  const treesGeo = new THREE.BufferGeometry();
  treesGeo.setAttribute('position', new THREE.Float32BufferAttribute(mergedPos, 3));
  treesGeo.setAttribute('normal', new THREE.Float32BufferAttribute(mergedNorm, 3));
  treesGeo.setAttribute('aBaseTint', new THREE.Float32BufferAttribute(mergedTint, 3));
  const treesMesh = new THREE.Mesh(treesGeo, silhouetteMat);
  treesMesh.frustumCulled = false;
  group.add(treesMesh);

  return group;
}

/**
 * Creates 85,000 fine-bladed wild grass stalks in a single InstancedMesh
 * with wind waves, spring-damper cursor parting, dewy grazing highlights,
 * and sunlit chartreuse tip translucency.
 */
export function createWildGrassSystem(
  uniforms: SharedMeadowUniforms,
  bladeCount = 85000
): THREE.InstancedMesh {
  // Fine, slender arched grass blade geometry (5 height segments, midrib normal angle)
  const segs = 5;
  const baseHalfWidth = 0.0095; // ~1.9cm slender botanical stalk/blade
  const positions: number[] = [];
  const normals: number[] = [];
  const heightRatios: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segs; i++) {
    const t = i / segs; // 0 at root -> 1 at tip
    const taper = Math.pow(1.0 - t, 0.72);
    const hw = baseHalfWidth * taper;
    const y = t;
    // Natural graceful forward arch
    const zCurve = Math.pow(t, 2.1) * 0.14;

    if (i < segs) {
      positions.push(-hw, y, zCurve);
      normals.push(-0.32, 0.22, 0.92);
      heightRatios.push(t);

      positions.push(hw, y, zCurve);
      normals.push(0.32, 0.22, 0.92);
      heightRatios.push(t);
    } else {
      // Crisp single tip vertex
      positions.push(0, y, zCurve);
      normals.push(0.0, 0.35, 0.94);
      heightRatios.push(1.0);
    }
  }

  for (let i = 0; i < segs - 1; i++) {
    const r0 = i * 2;
    const r1 = (i + 1) * 2;
    indices.push(r0, r0 + 1, r1);
    indices.push(r0 + 1, r1 + 1, r1);
  }
  const lastPair = (segs - 1) * 2;
  const tipIdx = segs * 2;
  indices.push(lastPair, lastPair + 1, tipIdx);

  const bladeGeo = new THREE.BufferGeometry();
  bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bladeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  bladeGeo.setAttribute('aHeightRatio', new THREE.Float32BufferAttribute(heightRatios, 1));
  bladeGeo.setIndex(indices);

  // Per-instance attributes:
  // aGrassData: (worldX, worldY, worldZ, bladeHeight)
  // aGrassStyle: (yawAngle, widthScale, colourSeed, bendStiffness)
  const grassData = new Float32Array(bladeCount * 4);
  const grassStyle = new Float32Array(bladeCount * 4);

  // Stratified golden-angle + camera-biased meadow distribution so the foreground
  // & focal plane are super lush while smoothly extending across the wide vista
  let seed = 918273;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < bladeCount; i++) {
    let x: number;
    let z: number;

    if (i < bladeCount * 0.30) {
      // Extra-dense immediate foreground & focal meadow thicket so zero bare earth peeks through
      const u = rand();
      const v = rand();
      const depthT = Math.pow(u, 0.88);
      z = 11.2 - depthT * 14.5; // z in [+11.2 .. -3.3]
      const halfSpanX = 5.4 + depthT * 8.5;
      x = (v * 2.0 - 1.0) * halfSpanX;
    } else if (i < bladeCount * 0.76) {
      // Primary camera frustum & mid-far meadow fan
      const u = rand();
      const v = rand();
      const depthT = Math.pow(u, 0.78);
      z = 12.5 - depthT * 48.0;
      const halfSpanX = 8.5 + depthT * 31.0;
      x = (v * 2.0 - 1.0) * halfSpanX;
    } else {
      // 360-degree surrounding meadow fill for seamless camera orbiting
      const r = Math.pow(rand(), 0.65) * 42.0;
      const theta = rand() * Math.PI * 2.0;
      x = Math.cos(theta) * r;
      z = Math.sin(theta) * r - 4.0;
    }

    const y = getTerrainHeight(x, z) - 0.03;

    // Lush tall slender meadow stalks & fine blades (0.54m .. 1.06m)
    const tuftNoise = Math.sin(x * 0.45) * Math.cos(z * 0.45) * 0.5 + 0.5;
    const height = (0.54 + Math.pow(rand(), 1.25) * 0.50) * (0.86 + tuftNoise * 0.24);

    grassData[i * 4 + 0] = x;
    grassData[i * 4 + 1] = y;
    grassData[i * 4 + 2] = z;
    grassData[i * 4 + 3] = height;

    grassStyle[i * 4 + 0] = rand() * Math.PI * 2.0; // yaw
    grassStyle[i * 4 + 1] = 0.72 + rand() * 0.68;   // width scale
    grassStyle[i * 4 + 2] = rand();                 // colour variation seed
    grassStyle[i * 4 + 3] = 0.75 + rand() * 0.55;   // wind flexibility
  }

  bladeGeo.setAttribute('aGrassData', new THREE.InstancedBufferAttribute(grassData, 4));
  bladeGeo.setAttribute('aGrassStyle', new THREE.InstancedBufferAttribute(grassStyle, 4));

  const grassMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uTime: uniforms.uTime,
      uSunDir: uniforms.uSunDir,
      uSunColor: uniforms.uSunColor,
      uSunIntensity: uniforms.uSunIntensity,
      uSkyLightColor: uniforms.uSkyLightColor,
      uGroundBounceColor: uniforms.uGroundBounceColor,
      uAmbientIntensity: uniforms.uAmbientIntensity,
      uFogColor: uniforms.uFogColor,
      uSunGlowFogColor: uniforms.uSunGlowFogColor,
      uFogDensity: uniforms.uFogDensity,
      uWindStrength: uniforms.uWindStrength,
      uTranslucency: uniforms.uTranslucency,
      uDewiness: uniforms.uDewiness,
      uBrushMap: uniforms.uBrushMap,
      uBrushBounds: uniforms.uBrushBounds,
    },
    vertexShader: /* glsl */ `
      ${GLSL_SIMPLEX_2D}
      ${GLSL_MEADOW_WIND}
      ${GLSL_BRUSH_SAMPLER}

      attribute float aHeightRatio;
      attribute vec4 aGrassData;  // xyz = rootPos, w = bladeHeight
      attribute vec4 aGrassStyle; // x = yaw, y = widthScale, z = colorSeed, w = flex

      uniform float uTime;
      uniform float uWindStrength;

      varying float vHeightRatio;
      varying float vColorSeed;
      varying float vGust;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vec3 rootPos = aGrassData.xyz;
        float bladeHeight = aGrassData.w;
        float yaw = aGrassStyle.x;
        float widthScale = aGrassStyle.y;
        float colorSeed = aGrassStyle.z;
        float flex = aGrassStyle.w;

        // Smooth distance taper so ultra-distant blades shrink cleanly into terrain undergrowth
        float camDist = length(rootPos.xz - cameraPosition.xz);
        float distFade = 1.0 - smoothstep(36.0, 49.0, camDist);
        if (distFade <= 0.005) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        // Local scaled blade coordinates
        vec3 localPos = vec3(
          position.x * widthScale * (1.0 + camDist * 0.025),
          position.y * bladeHeight * distFade,
          position.z * bladeHeight * distFade
        );

        float cy = cos(yaw);
        float sy = sin(yaw);
        vec3 rotatedPos = vec3(
          localPos.x * cy + localPos.z * sy,
          localPos.y,
          -localPos.x * sy + localPos.z * cy
        );
        vec3 rotatedNorm = normalize(vec3(
          normal.x * cy + normal.z * sy,
          normal.y,
          -normal.x * sy + normal.z * cy
        ));

        // Wind + Cursor Brush displacement (zero at root, quadratic toward tip)
        float bendWeight = pow(aHeightRatio, 1.75);
        WindSample ws = sampleMeadowWind(rootPos.xz, uTime, colorSeed, uWindStrength);
        vec2 windXZ = ws.offsetXZ * (0.34 * flex * bladeHeight) + vec2(ws.flutter * 0.022);

        vec3 brush = sampleCursorBrush(rootPos.xz);
        vec2 totalXZ = (windXZ + brush.xz * 0.72) * bendWeight;

        // Length-preserving vertical dip when blade bends horizontally
        float horizMag = min(length(totalXZ), bladeHeight * 0.82);
        float verticalDip = horizMag * 0.40 * aHeightRatio + brush.y * 0.26 * bendWeight * bladeHeight;

        vec3 worldPos = rootPos + rotatedPos;
        worldPos.xz += totalXZ;
        worldPos.y = max(rootPos.y + 0.01, worldPos.y - verticalDip);

        // Tilt normal slightly along bend direction for dynamic sun-gust sheen
        vec3 bentNormal = normalize(rotatedNorm + vec3(totalXZ.x, 0.35, totalXZ.y) * 0.85);

        vHeightRatio = aHeightRatio;
        vColorSeed = colorSeed;
        vGust = ws.gust;
        vWorldPos = worldPos;
        vWorldNormal = bentNormal;

        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_ATMOSPHERE_FOG}

      uniform vec3 uSunColor;
      uniform float uSunIntensity;
      uniform vec3 uSkyLightColor;
      uniform vec3 uGroundBounceColor;
      uniform float uAmbientIntensity;
      uniform float uTranslucency;
      uniform float uDewiness;

      varying float vHeightRatio;
      varying float vColorSeed;
      varying float vGust;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        // Botanical grass palette: muted olive roots -> sage stalks -> sunlit chartreuse/straw tips
        vec3 deepOlive  = vec3(0.115, 0.148, 0.048);
        vec3 mutedSage  = vec3(0.245, 0.295, 0.105);
        vec3 chartreuse = vec3(0.415, 0.455, 0.155);
        vec3 dryStraw   = vec3(0.465, 0.425, 0.195);

        vec3 midTone = mix(mutedSage, mix(chartreuse, dryStraw, smoothstep(0.65, 0.98, vColorSeed)), vColorSeed * 0.72);
        vec3 bladeAlbedo = mix(deepOlive, midTone, smoothstep(0.05, 0.78, vHeightRatio));
        bladeAlbedo = mix(bladeAlbedo, chartreuse * 1.12, pow(vHeightRatio, 2.6) * 0.45);

        // Deep natural root ambient occlusion tucked into the dense grass bed
        float rootAO = mix(0.22, 1.0, smoothstep(0.0, 0.72, vHeightRatio));

        vec3 N = normalize(gl_FrontFacing ? vWorldNormal : -vWorldNormal);
        vec3 L = normalize(uSunDir);
        vec3 V = normalize(cameraPosition - vWorldPos);

        // Wrapped botanical diffuse lighting
        float wrapDiff = clamp((dot(N, L) + 0.45) / 1.45, 0.0, 1.0);

        // Warm backlit subsurface translucency through slender sunlit grass tips
        float backLight = pow( clamp(dot(V, -L), 0.0, 1.0), 3.2 );
        float sss = backLight * (0.25 + 0.75 * vHeightRatio) * uTranslucency * 0.95;

        // Crisp dewy grazing specular sheen (pronounced in Morning & wind gusts)
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 28.0) * (0.16 + uDewiness * 0.52) * vHeightRatio * (0.65 + 0.35 * vGust);

        vec3 direct = uSunColor * uSunIntensity * (wrapDiff * 0.78 + sss);
        vec3 ambient = mix(uGroundBounceColor, uSkyLightColor, 0.35 + 0.65 * vHeightRatio) * uAmbientIntensity;

        vec3 lit = (bladeAlbedo * (direct + ambient) + uSunColor * spec * uSunIntensity * 0.42) * rootAO;
        lit = applyMeadowAerialPerspective(lit, vWorldPos, cameraPosition);

        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(bladeGeo, grassMat, bladeCount);
  mesh.frustumCulled = false; // Handled cleanly via world-space shader distance taper
  mesh.name = 'wild-grass-canopy';
  return mesh;
}
