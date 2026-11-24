import * as THREE from 'three';
import { FlowerSpecies, SampledBloomPoint } from '../types/meadow';
import {
  createPoppyBudGeometry,
  createRanunculusGeometry,
  createWildPoppyGeometry,
} from './botanicalGeometries';
import { SharedMeadowUniforms } from './environmentShaders';
import {
  GLSL_ATMOSPHERE_FOG,
  GLSL_BRUSH_SAMPLER,
  GLSL_MEADOW_WIND,
  GLSL_SIMPLEX_2D,
} from './glslCommon';
import { getTerrainHeight, sampleMeadowBotanicalZone } from './noise';

interface DynamicFlowerRecord {
  active: boolean;
  /** Delay countdown in seconds before stem begins shooting up */
  delay: number;
  /** Stem emergence 0..1 */
  stemGrowth: number;
  stemVel: number;
  /** Petal unfurl spring state 0..1+ */
  unfurl: number;
  unfurlVel: number;
  /** Shedding / receding state when CLEAR is triggered */
  shedding: boolean;
  shedDelay: number;
  shedProgress: number;
  hasSpawnedLoosePetals: boolean;
  worldX: number;
  worldY: number;
  worldZ: number;
  colorPrimary: THREE.Color;
}

interface SpeciesPool {
  species: FlowerSpecies;
  mesh: THREE.InstancedMesh;
  ambientCount: number;
  dynamicCapacity: number;
  nextDynamicCursor: number;
  transformArray: Float32Array;
  styleArray: Float32Array;
  colorPrimaryArray: Float32Array;
  colorSecondaryArray: Float32Array;
  bloomStateArray: Float32Array;
  bloomStateAttr: THREE.InstancedBufferAttribute;
  transformAttr: THREE.InstancedBufferAttribute;
  styleAttr: THREE.InstancedBufferAttribute;
  colorPrimaryAttr: THREE.InstancedBufferAttribute;
  colorSecondaryAttr: THREE.InstancedBufferAttribute;
  records: DynamicFlowerRecord[];
}

interface LoosePetalParticle {
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  scale: number;
}

interface PollenParticle {
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
}

function createFloralShaderMaterial(
  uniforms: SharedMeadowUniforms,
  apexOffset: THREE.Vector3,
  petalThinness: number
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
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
      uNightFactor: uniforms.uNightFactor,
      uBrushMap: uniforms.uBrushMap,
      uBrushBounds: uniforms.uBrushBounds,
      uApexOffset: { value: apexOffset },
      uPetalThinness: { value: petalThinness },
    },
    vertexShader: /* glsl */ `
      ${GLSL_SIMPLEX_2D}
      ${GLSL_MEADOW_WIND}
      ${GLSL_BRUSH_SAMPLER}

      attribute float aPart;            // 0 = stem/calyx, 1 = pod/heart, 2 = petal
      attribute vec2 aPetalUV;          // x = u (-1..1), y = v (0..1)
      attribute vec3 aBotanicalMeta;    // x = ringRatio, y = bakedAO, z = petalSeed

      attribute vec4 aInstanceTransform; // xyz = rootPos, w = stemHeight
      attribute vec4 aInstanceStyle;     // x = yaw, y = headScale, z = windFlex, w = isDynamic
      attribute vec3 aColorPrimary;
      attribute vec3 aColorSecondary;
      attribute vec4 aBloomState;        // x = stemGrowth, y = petalUnfurl, z = shedProgress, w = seed

      uniform float uTime;
      uniform float uWindStrength;
      uniform vec3 uApexOffset;

      varying float vPart;
      varying vec2 vPetalUV;
      varying float vRingRatio;
      varying float vBakedAO;
      varying vec3 vColorPrimary;
      varying vec3 vColorSecondary;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vShedAlpha;

      void main() {
        float stemGrowth = aBloomState.x;
        if (stemGrowth <= 0.004) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        vec3 rootPos = aInstanceTransform.xyz;
        float camDist = length(rootPos.xz - cameraPosition.xz);
        float distFade = 1.0 - smoothstep(42.0, 56.0, camDist);
        if (distFade <= 0.005) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        float stemHeight = aInstanceTransform.w * distFade;
        float yaw = aInstanceStyle.x;
        float headScale = aInstanceStyle.y * distFade;
        float windFlex = aInstanceStyle.z;
        float unfurl = aBloomState.y;
        float shed = aBloomState.z;
        float seed = aBloomState.w;

        // Recession scale when shedding completes
        float recedeFactor = 1.0 - smoothstep(0.45, 1.0, shed);
        float activeStemLen = stemHeight * stemGrowth * recedeFactor;
        if (activeStemLen <= 0.003) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        vec3 localPos = position;
        vec3 localNorm = normal;
        float heightAlongPlant = 0.0;

        if (aPart < 0.5) {
          // Stem & bract leaves
          heightAlongPlant = clamp(localPos.y, 0.0, 1.05);
          localPos.x *= headScale * (0.65 + 0.35 * stemGrowth);
          localPos.z *= headScale * (0.65 + 0.35 * stemGrowth);
          localPos.y *= activeStemLen;
        } else {
          // Flower head (pod heart or petals) anchored at uApexOffset
          heightAlongPlant = 1.0;
          vec3 rel = localPos - uApexOffset;

          // Bud swelling as stem rises
          float budSwell = smoothstep(0.10, 0.58, stemGrowth);

          if (aPart > 1.5) {
            // Staggered ring unfurling: outer petals peel open slightly ahead of inner heart
            float ringLag = (1.0 - aBotanicalMeta.x) * 0.18;
            float ringOpen = clamp((unfurl - ringLag) / max(1.0 - ringLag, 0.25), 0.0, 1.22);

            // Closed bud wraps petals inward (0.24x radial, slightly taller cup) -> open bloom (1.0x)
            float radialOpen = mix(0.24, 1.0, ringOpen) * (1.0 + shed * 0.42);
            float verticalCup = mix(0.76, 1.0, min(ringOpen, 1.0)) * (1.0 - shed * 0.32);

            rel.xz *= radialOpen;
            rel.y  *= verticalCup;

            // Subtle delicate wind flutter at outer crinkled petal rims
            float rimFlutter = sin(uTime * 4.4 + seed * 19.0 + aBotanicalMeta.z * 12.0)
                             * 0.0055 * aPetalUV.y * aPetalUV.y * uWindStrength * min(ringOpen, 1.0);
            rel.y += rimFlutter;

            // Gentle petal shrink/release during CLEAR wind-shedding
            float petalRelease = 1.0 - smoothstep(0.12 + aBotanicalMeta.z * 0.25, 0.72, shed);
            rel *= petalRelease;
          } else {
            // Seed pod / center core shrinks cleanly near end of shedding
            rel *= (1.0 - smoothstep(0.45, 0.92, shed));
          }

          // Nodding bud lifts upright as flower unfurls + natural organic head tilt per blossom
          float naturalPitch = (fract(seed * 13.7) - 0.5) * 0.42;
          float naturalRoll  = (fract(seed * 29.3) - 0.5) * 0.42;
          float budNod = (1.0 - clamp(unfurl, 0.0, 1.0)) * 0.52 + naturalPitch;
          float cn = cos(budNod);
          float sn = sin(budNod);
          float cr = cos(naturalRoll);
          float sr = sin(naturalRoll);

          vec3 rolledRel = vec3(rel.x * cr - rel.y * sr, rel.x * sr + rel.y * cr, rel.z);
          vec3 rolledNorm = vec3(localNorm.x * cr - localNorm.y * sr, localNorm.x * sr + localNorm.y * cr, localNorm.z);

          vec3 noddedRel = vec3(rolledRel.x, rolledRel.y * cn - rolledRel.z * sn, rolledRel.y * sn + rolledRel.z * cn);
          vec3 noddedNorm = vec3(rolledNorm.x, rolledNorm.y * cn - rolledNorm.z * sn, rolledNorm.y * sn + rolledNorm.z * cn);

          vec3 scaledApex = vec3(
            uApexOffset.x * headScale * (0.65 + 0.35 * stemGrowth),
            activeStemLen,
            uApexOffset.z * headScale * (0.65 + 0.35 * stemGrowth)
          );

          localPos = scaledApex + noddedRel * (headScale * budSwell);
          localNorm = noddedNorm;
        }

        // Rotate flower around Y by yaw
        float cy = cos(yaw);
        float sy = sin(yaw);
        vec3 rotPos = vec3(
          localPos.x * cy + localPos.z * sy,
          localPos.y,
          -localPos.x * sy + localPos.z * cy
        );
        vec3 rotNorm = normalize(vec3(
          localNorm.x * cy + localNorm.z * sy,
          localNorm.y,
          -localNorm.x * sy + localNorm.z * cy
        ));

        // Layered meadow wind + tactile 3D cursor brush displacement
        float bendFactor = pow(clamp(heightAlongPlant, 0.0, 1.0), 1.68);
        WindSample ws = sampleMeadowWind(rootPos.xz, uTime, seed, uWindStrength);
        vec2 windDisp = ws.offsetXZ * (0.38 * windFlex * activeStemLen)
                      + vec2(ws.flutter * 0.025 * activeStemLen);

        vec3 brush = sampleCursorBrush(rootPos.xz);
        vec2 totalXZ = (windDisp + brush.xz * 0.85) * bendFactor;

        // Arc-length vertical dip so swaying tall poppies bow gracefully without stretching
        float horizMag = min(length(totalXZ), activeStemLen * 0.78);
        float verticalDip = horizMag * 0.38 * heightAlongPlant + brush.y * 0.24 * bendFactor * activeStemLen;

        vec3 worldPos = rootPos + rotPos;
        worldPos.xz += totalXZ;
        worldPos.y = max(rootPos.y + 0.01, worldPos.y - verticalDip);

        // Rotate flower head normals slightly with stem bend so petals tilt naturally in wind
        vec2 tiltSlope = totalXZ / max(activeStemLen, 0.18);
        vec3 finalNorm = normalize(rotNorm + vec3(tiltSlope.x, 0.0, tiltSlope.y) * 0.45 * bendFactor);

        vPart = aPart;
        vPetalUV = aPetalUV;
        vRingRatio = aBotanicalMeta.x;
        vBakedAO = aBotanicalMeta.y;
        vColorPrimary = aColorPrimary;
        vColorSecondary = aColorSecondary;
        vWorldPos = worldPos;
        vWorldNormal = finalNorm;
        vShedAlpha = 1.0 - smoothstep(0.55, 0.98, shed);

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
      uniform float uNightFactor;
      uniform float uPetalThinness;

      varying float vPart;
      varying vec2 vPetalUV;
      varying float vRingRatio;
      varying float vBakedAO;
      varying vec3 vColorPrimary;
      varying vec3 vColorSecondary;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vShedAlpha;

      void main() {
        if (vShedAlpha <= 0.01) discard;

        vec3 N = normalize(gl_FrontFacing ? vWorldNormal : -vWorldNormal);
        vec3 L = normalize(uSunDir);
        vec3 V = normalize(cameraPosition - vWorldPos);

        vec3 litColor;

        if (vPart < 0.5) {
          // Slender botanical sage-olive flower stem & calyx
          vec3 stemBase = vec3(0.135, 0.175, 0.058);
          vec3 stemTop  = vec3(0.285, 0.345, 0.125);
          vec3 stemAlbedo = mix(stemBase, stemTop, clamp(vPetalUV.y, 0.0, 1.0));

          float wrapDiff = clamp((dot(N, L) + 0.4) / 1.4, 0.0, 1.0);
          float backLight = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0) * 0.45 * uTranslucency;
          float rootAO = mix(0.32, 1.0, smoothstep(0.0, 0.65, vPetalUV.y));

          vec3 direct = uSunColor * uSunIntensity * (wrapDiff * 0.8 + backLight);
          vec3 ambient = mix(uGroundBounceColor, uSkyLightColor, 0.55) * uAmbientIntensity;
          litColor = stemAlbedo * (direct + ambient) * rootAO;
        } else if (vPart < 1.5) {
          // Dark charcoal-plum poppy seed-pod capsule & anther crown
          vec3 podDark = vec3(0.055, 0.042, 0.048);
          vec3 podRim  = vec3(0.145, 0.155, 0.082);
          vec3 podAlbedo = mix(podDark, podRim, smoothstep(0.25, 0.95, vPetalUV.y));

          float diff = clamp((dot(N, L) + 0.3) / 1.3, 0.0, 1.0);
          litColor = podAlbedo * (uSunColor * uSunIntensity * diff * 0.85 + uSkyLightColor * uAmbientIntensity) * vBakedAO;
        } else {
          // PAPERY WILD POPPY & LAYERED RANUNCULUS PETALS
          float u = vPetalUV.x;
          float v = clamp(vPetalUV.y, 0.0, 1.0);

          // Rich botanical gradient: deeper secondary heart -> luminous primary sunlit petal -> delicate warm rim
          float heartGrad = smoothstep(0.04, 0.62, v) * (0.45 + 0.55 * vRingRatio);
          vec3 petalAlbedo = mix(vColorSecondary, vColorPrimary, heartGrad);

          // Delicate silk radial venation micro-texture (visible in razor-sharp foreground plane)
          float silkVein = sin(u * 42.0) * 0.032 * (1.0 - v * 0.35);
          petalAlbedo *= (1.0 + silkVein);

          // Soft wrapped botanical diffuse
          float wrapDiff = clamp((dot(N, L) + 0.38) / 1.38, 0.0, 1.0);

          // FAUX SUBSURFACE SCATTERING (Papery Backlit Translucency):
          // Preserves rich crimson/vermilion/marigold pigment warmth without whitewashing
          float viewBackSun = pow(clamp(dot(V, -L), 0.0, 1.0), 2.6);
          float normalBackSun = clamp((dot(-N, L) + 0.42) / 1.42, 0.0, 1.0);
          float thinProfile = mix(0.28, 1.0, smoothstep(0.08, 0.88, v)) * uPetalThinness;
          float sssAmount = (viewBackSun * 0.95 + normalBackSun * 0.52) * thinProfile * uTranslucency;

          // Transmitted light glows richly through saturated petal pigment
          vec3 sssPigment = mix(petalAlbedo, petalAlbedo * vec3(1.22, 0.92, 0.72), 0.35);
          vec3 sssTint = sssPigment * uSunColor * uSunIntensity * sssAmount;

          // Subtle silky Fresnel & morning dew specular highlight
          vec3 H = normalize(L + V);
          float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.6);
          float silkSpec = pow(max(dot(N, H), 0.0), 26.0) * (0.08 + uDewiness * 0.28) * v;

          vec3 direct = petalAlbedo * uSunColor * uSunIntensity * (wrapDiff * 0.88);
          vec3 ambient = petalAlbedo * mix(uGroundBounceColor, uSkyLightColor, 0.42 + 0.58 * v) * uAmbientIntensity * 1.04;
          vec3 rimSheen = mix(petalAlbedo, uSkyLightColor, 0.35) * fresnel * (0.10 + 0.22 * uNightFactor);

          litColor = (direct + ambient) * vBakedAO + sssTint * (0.50 + 0.50 * vBakedAO)
                   + uSunColor * silkSpec * uSunIntensity * 0.24 + rimSheen;
        }

        litColor = applyMeadowAerialPerspective(litColor, vWorldPos, cameraPosition);
        gl_FragColor = vec4(litColor, 1.0);
      }
    `,
  });
}

export class FloralMeadowSystem {
  public readonly group = new THREE.Group();

  private poppyPool: SpeciesPool;
  private ranunculusPool: SpeciesPool;
  private budsMesh: THREE.InstancedMesh;

  // Loose wind-borne shedding petals (triggered during CLEAR)
  private loosePetalsMesh: THREE.InstancedMesh;
  private loosePetals: LoosePetalParticle[] = [];
  private loosePetalCursor = 0;
  private loosePetalColors: Float32Array;
  private loosePetalColorAttr: THREE.InstancedBufferAttribute;

  // Sunlit pollen motes (triggered during Click-to-Sow & Text-to-Bloom)
  private pollenPoints: THREE.Points;
  private pollenParticles: PollenParticle[] = [];
  private pollenCursor = 0;
  private pollenPosArray: Float32Array;
  private pollenStateArray: Float32Array;
  private pollenPosAttr: THREE.BufferAttribute;
  private pollenStateAttr: THREE.BufferAttribute;

  private readonly dummyMatrix = new THREE.Matrix4();
  private readonly dummyPos = new THREE.Vector3();
  private readonly dummyQuat = new THREE.Quaternion();
  private readonly dummyEuler = new THREE.Euler();
  private readonly dummyScale = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private readonly tmpColor2 = new THREE.Color();

  constructor(private readonly uniforms: SharedMeadowUniforms) {
    this.group.name = 'floral-meadow-system';

    // Exact stem apex coordinates matching appendSinuousStem in botanicalGeometries.ts
    const poppyApex = new THREE.Vector3(
      Math.sin(1.15 * Math.PI) * 0.028,
      1.0,
      (1.0 - Math.cos(0.85 * Math.PI)) * 0.024
    );
    const ranuncApex = new THREE.Vector3(
      Math.sin(1.15 * Math.PI) * 0.020,
      1.0,
      (1.0 - Math.cos(0.85 * Math.PI)) * 0.018
    );

    this.poppyPool = this.createSpeciesPool(
      'poppy',
      createWildPoppyGeometry(),
      createFloralShaderMaterial(uniforms, poppyApex, 1.0),
      2900,
      2200
    );

    this.ranunculusPool = this.createSpeciesPool(
      'ranunculus',
      createRanunculusGeometry(),
      createFloralShaderMaterial(uniforms, ranuncApex, 0.72),
      2000,
      1800
    );

    this.budsMesh = this.createAmbientBuds(2400);
    this.group.add(this.poppyPool.mesh, this.ranunculusPool.mesh, this.budsMesh);

    this.populateAmbientMeadow();

    // Initialize wind-borne loose petals & sunlit pollen motes
    const { mesh: looseMesh, colors, colorAttr } = this.createLoosePetalPool(900);
    this.loosePetalsMesh = looseMesh;
    this.loosePetalColors = colors;
    this.loosePetalColorAttr = colorAttr;
    this.group.add(this.loosePetalsMesh);

    const pollenSetup = this.createPollenPool(650);
    this.pollenPoints = pollenSetup.points;
    this.pollenPosArray = pollenSetup.posArray;
    this.pollenStateArray = pollenSetup.stateArray;
    this.pollenPosAttr = pollenSetup.posAttr;
    this.pollenStateAttr = pollenSetup.stateAttr;
    this.group.add(this.pollenPoints);
  }

  private createSpeciesPool(
    species: FlowerSpecies,
    geometry: THREE.BufferGeometry,
    material: THREE.ShaderMaterial,
    ambientCount: number,
    dynamicCapacity: number
  ): SpeciesPool {
    const total = ambientCount + dynamicCapacity;
    const transformArray = new Float32Array(total * 4);
    const styleArray = new Float32Array(total * 4);
    const colorPrimaryArray = new Float32Array(total * 3);
    const colorSecondaryArray = new Float32Array(total * 3);
    const bloomStateArray = new Float32Array(total * 4);

    const transformAttr = new THREE.InstancedBufferAttribute(transformArray, 4);
    const styleAttr = new THREE.InstancedBufferAttribute(styleArray, 4);
    const colorPrimaryAttr = new THREE.InstancedBufferAttribute(colorPrimaryArray, 3);
    const colorSecondaryAttr = new THREE.InstancedBufferAttribute(colorSecondaryArray, 3);
    const bloomStateAttr = new THREE.InstancedBufferAttribute(bloomStateArray, 4);
    bloomStateAttr.setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute('aInstanceTransform', transformAttr);
    geometry.setAttribute('aInstanceStyle', styleAttr);
    geometry.setAttribute('aColorPrimary', colorPrimaryAttr);
    geometry.setAttribute('aColorSecondary', colorSecondaryAttr);
    geometry.setAttribute('aBloomState', bloomStateAttr);

    const mesh = new THREE.InstancedMesh(geometry, material, total);
    mesh.frustumCulled = false;
    mesh.name = `floral-pool-${species}`;

    const records: DynamicFlowerRecord[] = [];
    for (let i = 0; i < dynamicCapacity; i++) {
      records.push({
        active: false,
        delay: 0,
        stemGrowth: 0,
        stemVel: 0,
        unfurl: 0,
        unfurlVel: 0,
        shedding: false,
        shedDelay: 0,
        shedProgress: 0,
        hasSpawnedLoosePetals: false,
        worldX: 0,
        worldY: 0,
        worldZ: 0,
        colorPrimary: new THREE.Color(),
      });
    }

    return {
      species,
      mesh,
      ambientCount,
      dynamicCapacity,
      nextDynamicCursor: 0,
      transformArray,
      styleArray,
      colorPrimaryArray,
      colorSecondaryArray,
      bloomStateArray,
      bloomStateAttr,
      transformAttr,
      styleAttr,
      colorPrimaryAttr,
      colorSecondaryAttr,
      records,
    };
  }

  private createAmbientBuds(count: number): THREE.InstancedMesh {
    const geo = createPoppyBudGeometry();
    const budApex = new THREE.Vector3(0, 1.0, 0);
    const mat = createFloralShaderMaterial(this.uniforms, budApex, 0.35);

    const transformArray = new Float32Array(count * 4);
    const styleArray = new Float32Array(count * 4);
    const colorPrimaryArray = new Float32Array(count * 3);
    const colorSecondaryArray = new Float32Array(count * 3);
    const bloomStateArray = new Float32Array(count * 4);

    let seed = 551923;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < count; i++) {
      const u = Math.pow(rand(), 0.78);
      const z = 12.5 - u * 44.0;
      const spanX = 9.0 + u * 28.0;
      const x = (rand() * 2.0 - 1.0) * spanX;
      const y = getTerrainHeight(x, z) - 0.02;

      transformArray[i * 4 + 0] = x;
      transformArray[i * 4 + 1] = y;
      transformArray[i * 4 + 2] = z;
      transformArray[i * 4 + 3] = 0.56 + rand() * 0.44; // slender tall bud stems

      styleArray[i * 4 + 0] = rand() * Math.PI * 2.0;
      styleArray[i * 4 + 1] = 0.85 + rand() * 0.40;
      styleArray[i * 4 + 2] = 0.85 + rand() * 0.45;
      styleArray[i * 4 + 3] = 0.0;

      bloomStateArray[i * 4 + 0] = 1.0;
      bloomStateArray[i * 4 + 1] = 1.0;
      bloomStateArray[i * 4 + 2] = 0.0;
      bloomStateArray[i * 4 + 3] = rand();
    }

    geo.setAttribute('aInstanceTransform', new THREE.InstancedBufferAttribute(transformArray, 4));
    geo.setAttribute('aInstanceStyle', new THREE.InstancedBufferAttribute(styleArray, 4));
    geo.setAttribute('aColorPrimary', new THREE.InstancedBufferAttribute(colorPrimaryArray, 3));
    geo.setAttribute('aColorSecondary', new THREE.InstancedBufferAttribute(colorSecondaryArray, 3));
    geo.setAttribute('aBloomState', new THREE.InstancedBufferAttribute(bloomStateArray, 4));

    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    mesh.name = 'nodding-poppy-buds';
    return mesh;
  }

  /**
   * Plants the lush surrounding wildflower meadow in sweeping organic drifts
   * (deep crimson, rose, burnt tangerine, marigold, warm ivory), keeping a slightly
   * calmer breathing pocket in the immediate focal zone so newly typed floral phrases
   * read clearly while feeling completely native to the meadow.
   */
  private populateAmbientMeadow(): void {
    let seed = 20261124;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    let poppyIdx = 0;
    let ranuncIdx = 0;

    const writeAmbientSlot = (
      pool: SpeciesPool,
      idx: number,
      x: number,
      z: number,
      primaryHex: string,
      secondaryHex: string
    ) => {
      const y = getTerrainHeight(x, z) - 0.02;
      const isPoppy = pool.species === 'poppy';

      const stemH = isPoppy
        ? 0.68 + Math.pow(rand(), 0.9) * 0.46
        : 0.50 + Math.pow(rand(), 0.95) * 0.38;

      const headScale = isPoppy ? 0.86 + rand() * 0.44 : 0.88 + rand() * 0.42;

      pool.transformArray[idx * 4 + 0] = x;
      pool.transformArray[idx * 4 + 1] = y;
      pool.transformArray[idx * 4 + 2] = z;
      pool.transformArray[idx * 4 + 3] = stemH;

      pool.styleArray[idx * 4 + 0] = rand() * Math.PI * 2.0;
      pool.styleArray[idx * 4 + 1] = headScale;
      pool.styleArray[idx * 4 + 2] = (isPoppy ? 0.95 : 0.72) + rand() * 0.35;
      pool.styleArray[idx * 4 + 3] = 0.0;

      this.tmpColor.set(primaryHex);
      this.tmpColor2.set(secondaryHex);

      // Natural organic micro-shift per blossom so no two blooms are identical
      const hslShift = (rand() - 0.5) * 0.035;
      const lumShift = (rand() - 0.5) * 0.06;
      this.tmpColor.offsetHSL(hslShift, 0, lumShift);
      this.tmpColor2.offsetHSL(hslShift, 0, lumShift * 0.7);

      pool.colorPrimaryArray[idx * 3 + 0] = this.tmpColor.r;
      pool.colorPrimaryArray[idx * 3 + 1] = this.tmpColor.g;
      pool.colorPrimaryArray[idx * 3 + 2] = this.tmpColor.b;

      pool.colorSecondaryArray[idx * 3 + 0] = this.tmpColor2.r;
      pool.colorSecondaryArray[idx * 3 + 1] = this.tmpColor2.g;
      pool.colorSecondaryArray[idx * 3 + 2] = this.tmpColor2.b;

      pool.bloomStateArray[idx * 4 + 0] = 1.0;
      pool.bloomStateArray[idx * 4 + 1] = 0.88 + rand() * 0.20;
      pool.bloomStateArray[idx * 4 + 2] = 0.0;
      pool.bloomStateArray[idx * 4 + 3] = rand();
    };

    let safety = 0;
    while (
      (poppyIdx < this.poppyPool.ambientCount || ranuncIdx < this.ranunculusPool.ambientCount) &&
      safety < 45000
    ) {
      safety++;
      let x: number;
      let z: number;

      if (rand() < 0.78) {
        // Primary forward meadow vista (foreground bokeh zone z=+13 out to z=-44)
        const u = Math.pow(rand(), 0.82);
        z = 13.0 - u * 57.0;
        const halfSpanX = 8.8 + u * 35.0;
        x = (rand() * 2.0 - 1.0) * halfSpanX;
      } else {
        // 360-degree surrounding field
        const r = 6.0 + Math.pow(rand(), 0.7) * 44.0;
        const ang = rand() * Math.PI * 2.0;
        x = Math.cos(ang) * r;
        z = Math.sin(ang) * r - 4.0;
      }

      const zone = sampleMeadowBotanicalZone(x, z, rand());

      // Slightly moderated ambient density right inside the central focal "canvas"
      // (x in [-6.5, 6.5], z in [-2.5, 4.0]) so newly typed blooms weave seamlessly
      // into existing blooms without overcrowding
      const inFocalStage =
        Math.abs(x) < 6.5 && z > -2.5 && z < 4.2 ? 0.58 : 1.0;

      if (rand() > zone.density * inFocalStage) continue;

      if (zone.species === 'ranunculus' && ranuncIdx < this.ranunculusPool.ambientCount) {
        // Plant ranunculus in lush clustered drifts of 2-3 heads nestled close together!
        const clusterCount = Math.min(
          1 + Math.floor(rand() * 3),
          this.ranunculusPool.ambientCount - ranuncIdx
        );
        for (let c = 0; c < clusterCount; c++) {
          const cx = x + (c === 0 ? 0 : (rand() - 0.5) * 0.42);
          const cz = z + (c === 0 ? 0 : (rand() - 0.5) * 0.42);
          writeAmbientSlot(
            this.ranunculusPool,
            ranuncIdx++,
            cx,
            cz,
            zone.color.primary,
            zone.color.secondary
          );
        }
      } else if (poppyIdx < this.poppyPool.ambientCount) {
        writeAmbientSlot(
          this.poppyPool,
          poppyIdx++,
          x,
          z,
          zone.color.primary,
          zone.color.secondary
        );
      } else if (ranuncIdx < this.ranunculusPool.ambientCount) {
        writeAmbientSlot(
          this.ranunculusPool,
          ranuncIdx++,
          x,
          z,
          zone.color.primary,
          zone.color.secondary
        );
      }
    }

    for (const pool of [this.poppyPool, this.ranunculusPool]) {
      pool.transformAttr.needsUpdate = true;
      pool.styleAttr.needsUpdate = true;
      pool.colorPrimaryAttr.needsUpdate = true;
      pool.colorSecondaryAttr.needsUpdate = true;
      pool.bloomStateAttr.needsUpdate = true;
    }
  }

  /**
   * Sows a batch of sampled blooms (from Text-to-Bloom or Click-to-Sow) with
   * sequential stroke delays and staggered spring physics.
   */
  public sowBlooms(points: SampledBloomPoint[], baseStaggerDuration = 1.65): void {
    let poppyDirty = false;
    let ranuncDirty = false;

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const pool = pt.species === 'poppy' ? this.poppyPool : this.ranunculusPool;

      const recIdx = pool.nextDynamicCursor;
      pool.nextDynamicCursor = (pool.nextDynamicCursor + 1) % pool.dynamicCapacity;
      const slot = pool.ambientCount + recIdx;

      const y = getTerrainHeight(pt.x, pt.z) - 0.02;
      const isPoppy = pt.species === 'poppy';

      // Slightly taller stems on upper glyph strokes so low-angle perspective reads effortlessly
      const heightBoost = 0.96 + pt.glyphHeightRatio * 0.36;
      const baseHeight = isPoppy
        ? (0.86 + Math.random() * 0.24) * heightBoost * pt.scale
        : (0.72 + Math.random() * 0.22) * heightBoost * pt.scale;

      pool.transformArray[slot * 4 + 0] = pt.x;
      pool.transformArray[slot * 4 + 1] = y;
      pool.transformArray[slot * 4 + 2] = pt.z;
      pool.transformArray[slot * 4 + 3] = baseHeight;

      pool.styleArray[slot * 4 + 0] = Math.random() * Math.PI * 2.0;
      pool.styleArray[slot * 4 + 1] = (isPoppy ? 1.02 : 1.06) * pt.scale * (0.9 + Math.random() * 0.22);
      pool.styleArray[slot * 4 + 2] = isPoppy ? 1.0 : 0.78;
      pool.styleArray[slot * 4 + 3] = 1.0;

      this.tmpColor.set(pt.primaryHex).offsetHSL((Math.random() - 0.5) * 0.025, 0, (Math.random() - 0.5) * 0.04);
      this.tmpColor2.set(pt.secondaryHex);

      pool.colorPrimaryArray[slot * 3 + 0] = this.tmpColor.r;
      pool.colorPrimaryArray[slot * 3 + 1] = this.tmpColor.g;
      pool.colorPrimaryArray[slot * 3 + 2] = this.tmpColor.b;

      pool.colorSecondaryArray[slot * 3 + 0] = this.tmpColor2.r;
      pool.colorSecondaryArray[slot * 3 + 1] = this.tmpColor2.g;
      pool.colorSecondaryArray[slot * 3 + 2] = this.tmpColor2.b;

      const seed = Math.random();
      pool.bloomStateArray[slot * 4 + 0] = 0.0;
      pool.bloomStateArray[slot * 4 + 1] = 0.0;
      pool.bloomStateArray[slot * 4 + 2] = 0.0;
      pool.bloomStateArray[slot * 4 + 3] = seed;

      const rec = pool.records[recIdx];
      rec.active = true;
      rec.delay = pt.strokeProgress * baseStaggerDuration + Math.random() * 0.16;
      rec.stemGrowth = 0.0;
      rec.stemVel = 0.0;
      rec.unfurl = 0.0;
      rec.unfurlVel = 0.0;
      rec.shedding = false;
      rec.shedDelay = 0.0;
      rec.shedProgress = 0.0;
      rec.hasSpawnedLoosePetals = false;
      rec.worldX = pt.x;
      rec.worldY = y + baseHeight;
      rec.worldZ = pt.z;
      rec.colorPrimary.copy(this.tmpColor);

      if (isPoppy) poppyDirty = true;
      else ranuncDirty = true;

      // Subtle sunlit pollen mote shimmer on every ~3rd sown flower
      if (i % 3 === 0) {
        this.emitPollenBurst(pt.x, y + baseHeight * 0.72, pt.z, 2);
      }
    }

    if (poppyDirty) {
      this.poppyPool.transformAttr.needsUpdate = true;
      this.poppyPool.styleAttr.needsUpdate = true;
      this.poppyPool.colorPrimaryAttr.needsUpdate = true;
      this.poppyPool.colorSecondaryAttr.needsUpdate = true;
      this.poppyPool.bloomStateAttr.needsUpdate = true;
    }
    if (ranuncDirty) {
      this.ranunculusPool.transformAttr.needsUpdate = true;
      this.ranunculusPool.styleAttr.needsUpdate = true;
      this.ranunculusPool.colorPrimaryAttr.needsUpdate = true;
      this.ranunculusPool.colorSecondaryAttr.needsUpdate = true;
      this.ranunculusPool.bloomStateAttr.needsUpdate = true;
    }
  }

  /**
   * Gently sheds petals into the wind across all user-sown blooms and recedes
   * their stems smoothly back into the wild grass canopy.
   */
  public clearUserBlooms(): number {
    let clearedCount = 0;
    for (const pool of [this.poppyPool, this.ranunculusPool]) {
      for (let i = 0; i < pool.dynamicCapacity; i++) {
        const rec = pool.records[i];
        if (rec.active && !rec.shedding) {
          rec.shedding = true;
          // Sweep wind-shedding wave organically from left/upwind to right/downwind
          const upwindOrder = clamp01((rec.worldX + 14.0) / 28.0);
          rec.shedDelay = upwindOrder * 0.65 + Math.random() * 0.25;
          rec.shedProgress = 0.0;
          rec.hasSpawnedLoosePetals = false;
          clearedCount++;
        }
      }
    }
    return clearedCount;
  }

  public emitPollenBurst(x: number, y: number, z: number, count = 30): void {
    for (let i = 0; i < count; i++) {
      const idx = this.pollenCursor;
      this.pollenCursor = (this.pollenCursor + 1) % this.pollenParticles.length;
      const p = this.pollenParticles[idx];
      p.active = true;
      p.age = 0;
      p.life = 1.8 + Math.random() * 2.2;

      const ang = Math.random() * Math.PI * 2.0;
      const rad = Math.random() * 0.28;
      p.x = x + Math.cos(ang) * rad;
      p.y = y + (Math.random() - 0.3) * 0.18;
      p.z = z + Math.sin(ang) * rad;

      const speed = 0.18 + Math.random() * 0.45;
      p.vx = Math.cos(ang) * speed + 0.22;
      p.vy = 0.32 + Math.random() * 0.55;
      p.vz = Math.sin(ang) * speed + 0.14;
      p.size = 0.7 + Math.random() * 0.9;
    }
  }

  private spawnLoosePetalsFromFlower(rec: DynamicFlowerRecord, count: number): void {
    for (let k = 0; k < count; k++) {
      const idx = this.loosePetalCursor;
      this.loosePetalCursor = (this.loosePetalCursor + 1) % this.loosePetals.length;
      const lp = this.loosePetals[idx];

      lp.active = true;
      lp.age = 0;
      lp.life = 2.6 + Math.random() * 1.9;
      lp.x = rec.worldX + (Math.random() - 0.5) * 0.12;
      lp.y = rec.worldY + (Math.random() - 0.5) * 0.08;
      lp.z = rec.worldZ + (Math.random() - 0.5) * 0.12;

      // Prevailing diagonal meadow wind lifts and carries shed petals away
      lp.vx = 1.15 + Math.random() * 1.35;
      lp.vy = 0.22 + Math.random() * 0.58;
      lp.vz = 0.65 + (Math.random() - 0.3) * 0.95;

      lp.rotX = Math.random() * Math.PI * 2;
      lp.rotY = Math.random() * Math.PI * 2;
      lp.rotZ = Math.random() * Math.PI * 2;
      lp.spinX = (Math.random() - 0.5) * 4.8;
      lp.spinY = (Math.random() - 0.5) * 4.2;
      lp.spinZ = (Math.random() - 0.5) * 4.8;
      lp.scale = 0.85 + Math.random() * 0.45;

      this.loosePetalColors[idx * 3 + 0] = rec.colorPrimary.r;
      this.loosePetalColors[idx * 3 + 1] = rec.colorPrimary.g;
      this.loosePetalColors[idx * 3 + 2] = rec.colorPrimary.b;
    }
    this.loosePetalColorAttr.needsUpdate = true;
  }

  private createLoosePetalPool(capacity: number) {
    // Delicate single cupped petal geometry for wind-shedding
    const geo = new THREE.PlaneGeometry(0.085, 0.095, 3, 3);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const cupZ = (px * px * 95.0 + py * py * 55.0) * 0.04;
      pos.setZ(i, cupZ);
    }
    geo.computeVertexNormals();

    const colors = new Float32Array(capacity * 3);
    const colorAttr = new THREE.InstancedBufferAttribute(colors, 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPetalColor', colorAttr);

    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uSunDir: this.uniforms.uSunDir,
        uSunColor: this.uniforms.uSunColor,
        uSunIntensity: this.uniforms.uSunIntensity,
        uSkyLightColor: this.uniforms.uSkyLightColor,
        uAmbientIntensity: this.uniforms.uAmbientIntensity,
        uTranslucency: this.uniforms.uTranslucency,
        uFogColor: this.uniforms.uFogColor,
        uSunGlowFogColor: this.uniforms.uSunGlowFogColor,
        uFogDensity: this.uniforms.uFogDensity,
      },
      vertexShader: /* glsl */ `
        attribute vec3 aPetalColor;
        varying vec3 vColor;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;

        void main() {
          vec4 wp = instanceMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(instanceMatrix) * normal);
          vColor = aPetalColor;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        ${GLSL_ATMOSPHERE_FOG}
        uniform vec3 uSunColor;
        uniform float uSunIntensity;
        uniform vec3 uSkyLightColor;
        uniform float uAmbientIntensity;
        uniform float uTranslucency;

        varying vec3 vColor;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;

        void main() {
          vec3 N = normalize(gl_FrontFacing ? vWorldNormal : -vWorldNormal);
          vec3 L = normalize(uSunDir);
          vec3 V = normalize(cameraPosition - vWorldPos);
          float diff = clamp((dot(N, L) + 0.45) / 1.45, 0.0, 1.0);
          float back = pow(clamp(dot(V, -L), 0.0, 1.0), 2.2) * uTranslucency;

          vec3 col = vColor * (uSunColor * uSunIntensity * (diff * 0.85 + back) + uSkyLightColor * uAmbientIntensity);
          col = applyMeadowAerialPerspective(col, vWorldPos, cameraPosition);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;

    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) {
      mesh.setMatrixAt(i, zeroMat);
      this.loosePetals.push({
        active: false,
        age: 0,
        life: 1,
        x: 0,
        y: -10,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        spinX: 0,
        spinY: 0,
        spinZ: 0,
        scale: 0,
      });
    }
    mesh.instanceMatrix.needsUpdate = true;

    return { mesh, colors, colorAttr };
  }

  private createPollenPool(capacity: number) {
    const posArray = new Float32Array(capacity * 3);
    const stateArray = new Float32Array(capacity * 2); // (alpha, size)

    for (let i = 0; i < capacity; i++) {
      posArray[i * 3 + 1] = -50;
      this.pollenParticles.push({
        active: false,
        age: 0,
        life: 1,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 1,
      });
    }

    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(posArray, 3);
    const stateAttr = new THREE.BufferAttribute(stateArray, 2);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    stateAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('aPollenState', stateAttr);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSunColor: this.uniforms.uSunColor,
        uNightFactor: this.uniforms.uNightFactor,
      },
      vertexShader: /* glsl */ `
        attribute vec2 aPollenState;
        varying float vAlpha;

        void main() {
          vAlpha = aPollenState.x;
          if (vAlpha <= 0.002) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            return;
          }
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aPollenState.y * (115.0 / max(-mv.z, 0.5)), 1.5, 16.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunColor;
        uniform float uNightFactor;
        varying float vAlpha;

        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float glow = pow(1.0 - d, 2.4);
          vec3 tint = mix(uSunColor * vec3(1.15, 0.98, 0.72), vec3(0.75, 0.92, 0.65), uNightFactor);
          gl_FragColor = vec4(tint * glow * 1.15, glow * vAlpha * 0.78);
        }
      `,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.name = 'sunlit-pollen-motes';
    return { points, posArray, stateArray, posAttr, stateAttr };
  }

  /**
   * Steps spring-damper bloom emergence, petal unfurling, wind-shedding petals,
   * and sunlit pollen motes every frame. Returns count of flowers that just popped open
   * this frame so optional soft botanical audio chimes can respond.
   */
  public update(dt: number, elapsedTime: number): number {
    const safeDt = Math.min(dt, 0.05);
    let newlyOpenedCount = 0;

    for (const pool of [this.poppyPool, this.ranunculusPool]) {
      let dirty = false;

      for (let i = 0; i < pool.dynamicCapacity; i++) {
        const rec = pool.records[i];
        if (!rec.active) continue;

        const slot = pool.ambientCount + i;

        if (rec.delay > 0) {
          rec.delay -= safeDt;
          continue;
        }

        dirty = true;
        const prevUnfurl = rec.unfurl;

        if (!rec.shedding) {
          // 1. Stem shoots upward smoothly with damped spring
          const stemForce = (1.0 - rec.stemGrowth) * 22.0 - rec.stemVel * 7.2;
          rec.stemVel += stemForce * safeDt;
          rec.stemGrowth = Math.min(1.04, Math.max(0.0, rec.stemGrowth + rec.stemVel * safeDt));

          // 2. Once stem reaches ~38% height, bud swells & petals unfurl with lively botanical spring
          if (rec.stemGrowth > 0.36) {
            const unfurlForce = (1.0 - rec.unfurl) * 28.0 - rec.unfurlVel * 5.6;
            rec.unfurlVel += unfurlForce * safeDt;
            rec.unfurl = Math.max(0.0, rec.unfurl + rec.unfurlVel * safeDt);

            if (prevUnfurl < 0.45 && rec.unfurl >= 0.45) {
              newlyOpenedCount++;
            }
          }
        } else {
          // Poetic CLEAR wind-shedding & recession back into the meadow grass
          if (rec.shedDelay > 0) {
            rec.shedDelay -= safeDt;
          } else {
            rec.shedProgress += safeDt * 0.72;
            if (!rec.hasSpawnedLoosePetals && rec.shedProgress > 0.14 && rec.unfurl > 0.3) {
              rec.hasSpawnedLoosePetals = true;
              this.spawnLoosePetalsFromFlower(rec, pool.species === 'poppy' ? 4 : 5);
            }
            if (rec.shedProgress >= 1.0) {
              rec.active = false;
              rec.stemGrowth = 0;
              rec.unfurl = 0;
              rec.shedProgress = 0;
            }
          }
        }

        pool.bloomStateArray[slot * 4 + 0] = rec.stemGrowth;
        pool.bloomStateArray[slot * 4 + 1] = rec.unfurl;
        pool.bloomStateArray[slot * 4 + 2] = rec.shedProgress;
      }

      if (dirty) {
        pool.bloomStateAttr.needsUpdate = true;
      }
    }

    // Update drifting loose petals
    let looseDirty = false;
    for (let i = 0; i < this.loosePetals.length; i++) {
      const lp = this.loosePetals[i];
      if (!lp.active) continue;
      looseDirty = true;

      lp.age += safeDt;
      if (lp.age >= lp.life) {
        lp.active = false;
        this.dummyScale.set(0, 0, 0);
        this.dummyMatrix.makeScale(0, 0, 0);
        this.loosePetalsMesh.setMatrixAt(i, this.dummyMatrix);
        continue;
      }

      const lifeT = lp.age / lp.life;
      // Gently buoyant turbulent breeze drift
      const swirlY = Math.sin(elapsedTime * 3.1 + i * 1.7) * 0.35 - 0.14;
      lp.x += lp.vx * safeDt;
      lp.y += (lp.vy * (1.0 - lifeT * 0.8) + swirlY) * safeDt;
      lp.z += (lp.vz + Math.cos(elapsedTime * 2.3 + i) * 0.35) * safeDt;

      lp.rotX += lp.spinX * safeDt;
      lp.rotY += lp.spinY * safeDt;
      lp.rotZ += lp.spinZ * safeDt;

      const fadeScale = lp.scale * Math.sin(Math.min(1.0, lifeT * 4.5) * Math.PI * 0.5) * (1.0 - Math.pow(lifeT, 2.2));
      this.dummyPos.set(lp.x, lp.y, lp.z);
      this.dummyEuler.set(lp.rotX, lp.rotY, lp.rotZ);
      this.dummyQuat.setFromEuler(this.dummyEuler);
      this.dummyScale.setScalar(Math.max(0.0001, fadeScale));
      this.dummyMatrix.compose(this.dummyPos, this.dummyQuat, this.dummyScale);
      this.loosePetalsMesh.setMatrixAt(i, this.dummyMatrix);
    }
    if (looseDirty) {
      this.loosePetalsMesh.instanceMatrix.needsUpdate = true;
    }

    // Update sunlit pollen motes
    let pollenDirty = false;
    for (let i = 0; i < this.pollenParticles.length; i++) {
      const p = this.pollenParticles[i];
      if (!p.active) continue;
      pollenDirty = true;

      p.age += safeDt;
      if (p.age >= p.life) {
        p.active = false;
        this.pollenStateArray[i * 2 + 0] = 0.0;
        continue;
      }

      const t = p.age / p.life;
      p.vx *= 0.985;
      p.vy *= 0.975;
      p.vz *= 0.985;

      p.x += (p.vx + Math.sin(elapsedTime * 1.9 + i) * 0.16 + 0.18) * safeDt;
      p.y += (p.vy + Math.cos(elapsedTime * 2.4 + i * 0.7) * 0.08) * safeDt;
      p.z += (p.vz + 0.10) * safeDt;

      const env = Math.sin(t * Math.PI);
      this.pollenPosArray[i * 3 + 0] = p.x;
      this.pollenPosArray[i * 3 + 1] = p.y;
      this.pollenPosArray[i * 3 + 2] = p.z;
      this.pollenStateArray[i * 2 + 0] = env;
      this.pollenStateArray[i * 2 + 1] = p.size;
    }
    if (pollenDirty) {
      this.pollenPosAttr.needsUpdate = true;
      this.pollenStateAttr.needsUpdate = true;
    }

    return newlyOpenedCount;
  }

  public dispose(): void {
    this.poppyPool.mesh.geometry.dispose();
    (this.poppyPool.mesh.material as THREE.Material).dispose();
    this.ranunculusPool.mesh.geometry.dispose();
    (this.ranunculusPool.mesh.material as THREE.Material).dispose();
    this.budsMesh.geometry.dispose();
    (this.budsMesh.material as THREE.Material).dispose();
    this.loosePetalsMesh.geometry.dispose();
    (this.loosePetalsMesh.material as THREE.Material).dispose();
    this.pollenPoints.geometry.dispose();
    (this.pollenPoints.material as THREE.Material).dispose();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
