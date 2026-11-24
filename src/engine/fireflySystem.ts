import * as THREE from 'three';
import { getTerrainHeight } from './noise';

interface FireflyAgent {
  anchorX: number;
  anchorZ: number;
  hoverHeight: number;
  freqX: number;
  freqY: number;
  freqZ: number;
  phase: number;
  pulseSpeed: number;
  pulsePhase: number;
  size: number;
  hueWarmth: number;
  // Interactive cursor swirl/scatter offset + velocity
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  velX: number;
  velY: number;
  velZ: number;
}

/**
 * 290 bioluminescent nighttime fireflies rendered via a custom GLSL Points shader
 * with soft radial glow falloff, organic 3D curl-like hovering drift just above the
 * flower canopy, slow chartreuse-gold pulsing, and gentle swirl/scatter response to
 * the 3D cursor.
 */
export class NightFireflySystem {
  public readonly points: THREE.Points;
  private readonly count: number;
  private readonly agents: FireflyAgent[] = [];
  private readonly posArray: Float32Array;
  private readonly metaArray: Float32Array; // (pulseIntensity, pointScale, hueWarmth)
  private readonly posAttr: THREE.BufferAttribute;
  private readonly metaAttr: THREE.BufferAttribute;
  private readonly visibilityUniform = { value: 0.0 };

  constructor(count = 290) {
    this.count = count;
    this.posArray = new Float32Array(count * 3);
    this.metaArray = new Float32Array(count * 3);

    let seed = 884217;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < count; i++) {
      let x: number;
      let z: number;
      if (i < count * 0.78) {
        const u = Math.pow(rand(), 0.72);
        z = 11.5 - u * 38.0;
        const spanX = 8.0 + u * 22.0;
        x = (rand() * 2.0 - 1.0) * spanX;
      } else {
        const r = 4.0 + rand() * 28.0;
        const ang = rand() * Math.PI * 2;
        x = Math.cos(ang) * r;
        z = Math.sin(ang) * r - 4.0;
      }

      this.agents.push({
        anchorX: x,
        anchorZ: z,
        hoverHeight: 0.52 + rand() * 1.35,
        freqX: 0.28 + rand() * 0.42,
        freqY: 0.45 + rand() * 0.55,
        freqZ: 0.25 + rand() * 0.40,
        phase: rand() * Math.PI * 2.0,
        pulseSpeed: 0.85 + rand() * 1.25,
        pulsePhase: rand() * Math.PI * 2.0,
        size: 0.85 + rand() * 0.85,
        hueWarmth: rand(),
        offsetX: 0,
        offsetY: 0,
        offsetZ: 0,
        velX: 0,
        velY: 0,
        velZ: 0,
      });
    }

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.posArray, 3);
    this.metaAttr = new THREE.BufferAttribute(this.metaArray, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.metaAttr.setUsage(THREE.DynamicDrawUsage);

    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aFireflyMeta', this.metaAttr);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uVisibility: this.visibilityUniform,
      },
      vertexShader: /* glsl */ `
        attribute vec3 aFireflyMeta; // x = pulseGlow, y = size, z = hueWarmth
        uniform float uVisibility;

        varying float vGlow;
        varying float vHueWarmth;

        void main() {
          vGlow = aFireflyMeta.x * uVisibility;
          vHueWarmth = aFireflyMeta.z;

          if (vGlow <= 0.002) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            return;
          }

          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = max(-mv.z, 0.8);
          gl_PointSize = clamp(aFireflyMeta.y * (195.0 / dist), 2.5, 38.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vGlow;
        varying float vHueWarmth;

        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float r = length(uv) * 2.0;
          if (r > 1.0) discard;

          // Crisp incandescent bioluminescent core + soft dreamy radial halo
          float core = exp(-r * r * 14.0);
          float halo = pow(1.0 - r, 2.6) * 0.52;

          vec3 chartreuseBio = vec3(0.76, 0.96, 0.28);
          vec3 warmGoldBio   = vec3(0.98, 0.86, 0.34);
          vec3 outerColor    = mix(chartreuseBio, warmGoldBio, vHueWarmth);
          vec3 coreColor     = vec3(1.0, 0.99, 0.84);

          vec3 col = (outerColor * halo + coreColor * core * 1.45) * vGlow * 1.55;
          float alpha = clamp((halo + core) * vGlow, 0.0, 1.0);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.name = 'night-fireflies';
  }

  public update(
    dt: number,
    elapsedTime: number,
    visibility: number,
    cursorActive: boolean,
    cursorWorld: THREE.Vector3,
    cursorVelXZ: THREE.Vector2
  ): void {
    this.visibilityUniform.value = visibility;
    if (visibility <= 0.002) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;

    const safeDt = Math.min(dt, 0.05);

    for (let i = 0; i < this.count; i++) {
      const f = this.agents[i];

      // Organic 3D Lissajous / curl-like meadow drift
      const t = elapsedTime;
      const wanderX =
        Math.sin(t * f.freqX + f.phase) * 1.15 +
        Math.cos(t * f.freqZ * 0.65 - f.phase * 1.3) * 0.55;
      const wanderZ =
        Math.cos(t * f.freqZ + f.phase * 0.8) * 1.15 +
        Math.sin(t * f.freqX * 0.72 + f.phase) * 0.55;
      const wanderY =
        Math.sin(t * f.freqY + f.phase * 1.7) * 0.26 +
        Math.cos(t * f.freqY * 0.52) * 0.14;

      const baseX = f.anchorX + wanderX;
      const baseZ = f.anchorZ + wanderZ;
      const groundY = getTerrainHeight(baseX, baseZ);
      const baseY = groundY + f.hoverHeight + wanderY;

      // Gentle cursor swirl & scatter interaction when brushing near fireflies
      if (cursorActive) {
        const curX = baseX + f.offsetX;
        const curZ = baseZ + f.offsetZ;
        const dx = curX - cursorWorld.x;
        const dz = curZ - cursorWorld.z;
        const distSq = dx * dx + dz * dz;
        const influenceR = 3.2;

        if (distSq < influenceR * influenceR && distSq > 0.001) {
          const dist = Math.sqrt(distSq);
          const falloff = Math.pow(1.0 - dist / influenceR, 1.6);
          const nx = dx / dist;
          const nz = dz / dist;
          // Tangential swirl + gentle outward scatter + upward lift
          const swirlX = -nz;
          const swirlZ = nx;

          f.velX += (nx * 4.2 + swirlX * 3.4 + cursorVelXZ.x * 0.28) * falloff * safeDt;
          f.velZ += (nz * 4.2 + swirlZ * 3.4 + cursorVelXZ.y * 0.28) * falloff * safeDt;
          f.velY += 2.2 * falloff * safeDt;
        }
      }

      // Soft spring restoration back to organic hovering path
      f.velX += (-1.8 * f.offsetX - 2.4 * f.velX) * safeDt;
      f.velY += (-2.2 * f.offsetY - 2.6 * f.velY) * safeDt;
      f.velZ += (-1.8 * f.offsetZ - 2.4 * f.velZ) * safeDt;

      f.offsetX += f.velX * safeDt;
      f.offsetY += f.velY * safeDt;
      f.offsetZ += f.velZ * safeDt;

      const wx = baseX + f.offsetX;
      const wy = Math.max(groundY + 0.28, baseY + f.offsetY);
      const wz = baseZ + f.offsetZ;

      // Slow natural firefly bioluminescence wave (lingering glow + gentle rest)
      const rawWave = Math.sin(t * f.pulseSpeed + f.pulsePhase) * 0.5 + 0.5;
      const pulse = 0.14 + 0.86 * Math.pow(rawWave, 2.2);

      this.posArray[i * 3 + 0] = wx;
      this.posArray[i * 3 + 1] = wy;
      this.posArray[i * 3 + 2] = wz;

      this.metaArray[i * 3 + 0] = pulse;
      this.metaArray[i * 3 + 1] = f.size * (0.82 + 0.28 * pulse);
      this.metaArray[i * 3 + 2] = f.hueWarmth;
    }

    this.posAttr.needsUpdate = true;
    this.metaAttr.needsUpdate = true;
  }

  public dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
