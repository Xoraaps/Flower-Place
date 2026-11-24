import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SowEventSummary, TimeOfDay } from '../types/meadow';
import {
  ATMOSPHERE_PRESETS,
  AtmosphereState,
  cloneAtmosphereState,
  interpolateAtmosphere,
} from './atmospherePresets';
import { CursorBrushField } from './cursorBrushField';
import {
  SharedMeadowUniforms,
  createHorizonLandscape,
  createSkyDome,
  createTerrainMesh,
  createWildGrassSystem,
} from './environmentShaders';
import { NightFireflySystem } from './fireflySystem';
import { FloralMeadowSystem } from './floralSystem';
import { MeadowAudioEngine } from './meadowAudio';
import { getTerrainHeight } from './noise';
import { MeadowPostProcessor } from './postProcessing';
import {
  MeadowProjectionFrame,
  createClickClusterPoints,
  rasterizePhraseToMeadow,
} from './semanticBotany';

export interface MeadowSceneCallbacks {
  onSowPhrase?: (summary: SowEventSummary) => void;
}

export class MeadowScene {
  private readonly container: HTMLElement;
  private readonly callbacks: MeadowSceneCallbacks;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly postProcessor: MeadowPostProcessor;

  private readonly brushField: CursorBrushField;
  private readonly uniforms: SharedMeadowUniforms;
  private readonly skyDome: THREE.Mesh;
  private readonly terrainMesh: THREE.Mesh;
  private readonly horizonGroup: THREE.Group;
  private readonly grassMesh: THREE.InstancedMesh;
  private readonly floralSystem: FloralMeadowSystem;
  private readonly fireflies: NightFireflySystem;
  public readonly audio: MeadowAudioEngine;

  // Time-of-Day 1.5s smooth transition state
  private currentTimeOfDay: TimeOfDay = 'afternoon';
  private readonly currentAtmo: AtmosphereState;
  private fromAtmo: AtmosphereState;
  private toAtmo: AtmosphereState;
  private transitionProgress = 1.0;
  private readonly transitionDuration = 1.55;

  // Default low cinematic eye-level camera anchor
  private readonly defaultCamPos: THREE.Vector3;
  private readonly defaultCamTarget: THREE.Vector3;
  private isResettingCamera = false;
  private resetProgress = 0;
  private readonly resetStartPos = new THREE.Vector3();
  private readonly resetStartTarget = new THREE.Vector3();

  // Subtle mouse-parallax breathing state (decoupled cleanly from OrbitControls)
  private readonly pointerNDC = new THREE.Vector2(0, 0);
  private readonly smoothedPointerNDC = new THREE.Vector2(0, 0);
  private readonly appliedParallaxOffset = new THREE.Vector3(0, 0, 0);
  private pointerInsideViewport = false;

  // Click-to-Sow gesture tracking (distinguishes crisp click from orbit drag)
  private pointerDownPos = new THREE.Vector2();
  private pointerDownTime = 0;
  private isPointerDownOnCanvas = false;

  // Ray marching scratch vectors
  private readonly raycaster = new THREE.Raycaster();
  private readonly rayHitPoint = new THREE.Vector3();
  private readonly camRightXZ = new THREE.Vector2();
  private readonly camForwardXZ = new THREE.Vector2();

  private rafId = 0;
  private lastFrameTime = performance.now();
  private elapsedTime = 0;
  private disposed = false;

  constructor(container: HTMLElement, callbacks: MeadowSceneCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // Handled cleanly via HDR Depth RenderTarget + FXAA pass
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    // Low cinematic eye-level perspective (42mm full-frame equivalent ~ 39 deg vertical FOV)
    this.camera = new THREE.PerspectiveCamera(39, width / height, 0.25, 240);

    const startZ = 10.6;
    const targetZ = 0.8;
    this.defaultCamPos = new THREE.Vector3(0.0, getTerrainHeight(0, startZ) + 1.38, startZ);
    this.defaultCamTarget = new THREE.Vector3(0.0, getTerrainHeight(0, targetZ) + 0.90, targetZ);

    this.camera.position.copy(this.defaultCamPos);
    this.camera.lookAt(this.defaultCamTarget);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.defaultCamTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.042;
    this.controls.rotateSpeed = 0.44;
    this.controls.zoomSpeed = 0.55;
    this.controls.panSpeed = 0.45;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 4.2;
    this.controls.maxDistance = 22.0;
    // Strict polar limits so camera glides just above the flower canopy without going underground
    this.controls.minPolarAngle = Math.PI * 0.34;
    this.controls.maxPolarAngle = Math.PI * 0.492;

    // Initialize default Golden Hour (17:30 AFTERNOON) atmosphere
    this.currentAtmo = cloneAtmosphereState(ATMOSPHERE_PRESETS.afternoon);
    this.fromAtmo = cloneAtmosphereState(ATMOSPHERE_PRESETS.afternoon);
    this.toAtmo = cloneAtmosphereState(ATMOSPHERE_PRESETS.afternoon);
    this.renderer.toneMappingExposure = this.currentAtmo.exposure;

    this.brushField = new CursorBrushField();
    this.audio = new MeadowAudioEngine();

    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: this.currentAtmo.sunDir.clone() },
      uSunColor: { value: this.currentAtmo.sunColor.clone() },
      uSunIntensity: { value: this.currentAtmo.sunIntensity },
      uSkyLightColor: { value: this.currentAtmo.skyLightColor.clone() },
      uGroundBounceColor: { value: this.currentAtmo.groundBounceColor.clone() },
      uAmbientIntensity: { value: this.currentAtmo.ambientIntensity },
      uFogColor: { value: this.currentAtmo.fogColor.clone() },
      uSunGlowFogColor: { value: this.currentAtmo.sunGlowFogColor.clone() },
      uFogDensity: { value: this.currentAtmo.fogDensity },
      uWindStrength: { value: this.currentAtmo.windStrength },
      uTranslucency: { value: this.currentAtmo.translucency },
      uDewiness: { value: this.currentAtmo.dewiness },
      uNightFactor: { value: this.currentAtmo.nightFactor },
      uSkyZenith: { value: this.currentAtmo.skyZenith.clone() },
      uSkyMid: { value: this.currentAtmo.skyMid.clone() },
      uSkyHorizon: { value: this.currentAtmo.skyHorizon.clone() },
      uBrushMap: { value: this.brushField.texture },
      uBrushBounds: { value: this.brushField.bounds },
    };

    // Assemble world layers
    this.skyDome = createSkyDome(this.uniforms);
    this.terrainMesh = createTerrainMesh(this.uniforms);
    this.horizonGroup = createHorizonLandscape(this.uniforms);
    this.grassMesh = createWildGrassSystem(this.uniforms, 115000);
    this.floralSystem = new FloralMeadowSystem(this.uniforms);
    this.fireflies = new NightFireflySystem(290);

    this.scene.add(
      this.skyDome,
      this.terrainMesh,
      this.horizonGroup,
      this.grassMesh,
      this.floralSystem.group,
      this.fireflies.points
    );

    this.postProcessor = new MeadowPostProcessor(
      this.renderer,
      this.scene,
      this.camera,
      width,
      height
    );

    this.bindEvents();
    this.lastFrameTime = performance.now();
    this.animate();
  }

  public setTimeOfDay(nextTime: TimeOfDay): void {
    if (nextTime === this.currentTimeOfDay && this.transitionProgress >= 1.0) {
      return;
    }
    this.currentTimeOfDay = nextTime;
    this.fromAtmo = cloneAtmosphereState(this.currentAtmo);
    this.toAtmo = cloneAtmosphereState(ATMOSPHERE_PRESETS[nextTime]);
    this.transitionProgress = 0.0;
  }

  public getTimeOfDay(): TimeOfDay {
    return this.currentTimeOfDay;
  }

  /**
   * Rasterizes a typed word or phrase onto the meadow focal plane right ahead
   * of the camera and triggers sequential organic stem + petal spring emergence.
   */
  public bloomText(rawPhrase: string): SowEventSummary | null {
    const cleaned = rawPhrase.trim();
    if (!cleaned) return null;

    const frame = this.computeCurrentFocalProjectionFrame();
    const { profile, points } = rasterizePhraseToMeadow(cleaned, frame);
    if (points.length === 0) return null;

    const staggerDuration = Math.min(2.2, Math.max(1.15, cleaned.length * 0.14));
    this.floralSystem.sowBlooms(points, staggerDuration);

    // Subtle wind ripple along focal center when phrase begins rising
    this.brushField.injectRadialPulse(frame.centerXZ.x, frame.centerXZ.y, 0.55);
    this.audio.triggerBloomChime(0, 1.0);

    const summary: SowEventSummary = {
      phrase: cleaned,
      driftName: profile.driftName,
      stemCount: points.length,
    };
    this.callbacks.onSowPhrase?.(summary);
    return summary;
  }

  /**
   * Gently sheds petals into the wind and recedes all user-typed / clicked blooms
   * back into the wild grass.
   */
  public clearBlooms(): number {
    const count = this.floralSystem.clearUserBlooms();
    if (count > 0) {
      this.audio.triggerBloomChime(-0.2, 0.7);
    }
    return count;
  }

  public resetCameraView(): void {
    this.removeParallaxFromCamera();
    this.isResettingCamera = true;
    this.resetProgress = 0.0;
    this.resetStartPos.copy(this.camera.position);
    this.resetStartTarget.copy(this.controls.target);
  }

  private computeCurrentFocalProjectionFrame(): MeadowProjectionFrame {
    this.removeParallaxFromCamera();

    const dir3 = new THREE.Vector3()
      .subVectors(this.controls.target, this.camera.position);
    dir3.y = 0;
    if (dir3.lengthSq() < 0.001) {
      dir3.set(0, 0, -1);
    } else {
      dir3.normalize();
    }

    this.camForwardXZ.set(dir3.x, dir3.z);
    this.camRightXZ.set(-dir3.z, dir3.x);

    // Place text bloom focal center ~9.2m ahead of the camera lens (right in the sharp DoF plane)
    const focalDist = 9.2;
    const centerXZ = new THREE.Vector2(
      THREE.MathUtils.clamp(this.camera.position.x + dir3.x * focalDist, -14.0, 14.0),
      THREE.MathUtils.clamp(this.camera.position.z + dir3.z * focalDist, -12.0, 8.0)
    );

    this.reapplyParallaxToCamera();

    return {
      centerXZ,
      rightXZ: this.camRightXZ.clone(),
      forwardXZ: this.camForwardXZ.clone(),
    };
  }

  /**
   * Fast analytical heightfield ray-marcher: intersects camera ray against
   * y = getTerrainHeight(x, z) + canopyPlaneOffset in < 0.005ms.
   */
  private intersectMeadowRay(ndc: THREE.Vector2, canopyOffset = 0.25): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const orig = this.raycaster.ray.origin;
    const dir = this.raycaster.ray.direction;

    // Ignore rays pointing skyward
    if (dir.y >= -0.005) return null;

    let prevT = 0.6;
    const maxT = 46.0;
    const coarseSteps = 26;
    const stepT = (maxT - prevT) / coarseSteps;

    const evalHeightDiff = (t: number) => {
      const rx = orig.x + dir.x * t;
      const ry = orig.y + dir.y * t;
      const rz = orig.z + dir.z * t;
      return ry - (getTerrainHeight(rx, rz) + canopyOffset);
    };

    let prevDiff = evalHeightDiff(prevT);
    for (let i = 1; i <= coarseSteps; i++) {
      const currT = prevT + stepT;
      const currDiff = evalHeightDiff(currT);

      if (currDiff <= 0.0 && prevDiff >= 0.0) {
        // Refine intersection with 5 bisection steps
        let lo = prevT;
        let hi = currT;
        for (let b = 0; b < 5; b++) {
          const mid = (lo + hi) * 0.5;
          if (evalHeightDiff(mid) > 0) lo = mid;
          else hi = mid;
        }
        const hitT = (lo + hi) * 0.5;
        return this.rayHitPoint.set(
          orig.x + dir.x * hitT,
          getTerrainHeight(orig.x + dir.x * hitT, orig.z + dir.z * hitT),
          orig.z + dir.z * hitT
        );
      }

      prevT = currT;
      prevDiff = currDiff;
    }

    return null;
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    const dom = this.renderer.domElement;
    dom.addEventListener('pointermove', this.handlePointerMove);
    dom.addEventListener('pointerdown', this.handlePointerDown);
    dom.addEventListener('pointerup', this.handlePointerUp);
    dom.addEventListener('pointerleave', this.handlePointerLeave);
  }

  private readonly handleResize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.postProcessor.setSize(width, height);
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.pointerInsideViewport = true;
  };

  private readonly handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.isResettingCamera = false;
    this.isPointerDownOnCanvas = true;
    this.pointerDownPos.set(e.clientX, e.clientY);
    this.pointerDownTime = performance.now();

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.pointerInsideViewport = true;
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    if (!this.isPointerDownOnCanvas || e.button !== 0) return;
    this.isPointerDownOnCanvas = false;

    const moveDist = Math.hypot(
      e.clientX - this.pointerDownPos.x,
      e.clientY - this.pointerDownPos.y
    );
    const elapsed = performance.now() - this.pointerDownTime;

    // Tactile Click-to-Sow: plant an organic wildflower cluster at the exact clicked spot
    if (moveDist < 6.0 && elapsed < 340) {
      const hit = this.intersectMeadowRay(this.pointerNDC, 0.05);
      if (hit && Math.hypot(hit.x, hit.z) < 34.0) {
        const cluster = createClickClusterPoints(hit.x, hit.z);
        this.floralSystem.sowBlooms(cluster, 0.35);
        this.floralSystem.emitPollenBurst(hit.x, hit.y + 0.55, hit.z, 34);
        this.brushField.injectRadialPulse(hit.x, hit.z, 1.05);
        this.audio.triggerBloomChime(this.pointerNDC.x * 0.65, 0.95);
      }
    }
  };

  private readonly handlePointerLeave = (): void => {
    this.pointerInsideViewport = false;
    this.isPointerDownOnCanvas = false;
  };

  private removeParallaxFromCamera(): void {
    this.camera.position.sub(this.appliedParallaxOffset);
    this.appliedParallaxOffset.set(0, 0, 0);
  }

  private reapplyParallaxToCamera(): void {
    // Subtle breathing + gentle mouse parallax without disturbing OrbitControls state
    const breathX = Math.sin(this.elapsedTime * 0.42) * 0.022;
    const breathY = Math.cos(this.elapsedTime * 0.31) * 0.014;

    const px = this.smoothedPointerNDC.x * 0.11 + breathX;
    const py = this.smoothedPointerNDC.y * 0.045 + breathY;

    // Project horizontal parallax along camera's local right axis
    const forward = new THREE.Vector3()
      .subVectors(this.controls.target, this.camera.position)
      .normalize();
    const right = new THREE.Vector3().crossVectors(forward, THREE.Object3D.DEFAULT_UP).normalize();

    this.appliedParallaxOffset
      .copy(right)
      .multiplyScalar(px)
      .addScaledVector(THREE.Object3D.DEFAULT_UP, py);

    this.camera.position.add(this.appliedParallaxOffset);
  }

  private syncUniformsFromAtmosphere(): void {
    const a = this.currentAtmo;
    this.uniforms.uSkyZenith.value.copy(a.skyZenith);
    this.uniforms.uSkyMid.value.copy(a.skyMid);
    this.uniforms.uSkyHorizon.value.copy(a.skyHorizon);
    this.uniforms.uSunDir.value.copy(a.sunDir);
    this.uniforms.uSunColor.value.copy(a.sunColor);
    this.uniforms.uSunIntensity.value = a.sunIntensity;
    this.uniforms.uSkyLightColor.value.copy(a.skyLightColor);
    this.uniforms.uGroundBounceColor.value.copy(a.groundBounceColor);
    this.uniforms.uAmbientIntensity.value = a.ambientIntensity;
    this.uniforms.uFogColor.value.copy(a.fogColor);
    this.uniforms.uSunGlowFogColor.value.copy(a.sunGlowFogColor);
    this.uniforms.uFogDensity.value = a.fogDensity;
    this.uniforms.uWindStrength.value = a.windStrength;
    this.uniforms.uTranslucency.value = a.translucency;
    this.uniforms.uDewiness.value = a.dewiness;
    this.uniforms.uNightFactor.value = a.nightFactor;
    this.renderer.toneMappingExposure = a.exposure;
  }

  private readonly animate = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);

    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    this.elapsedTime += dt;
    this.uniforms.uTime.value = this.elapsedTime;

    // 1. Update Time-of-Day atmosphere interpolation (~1.5s)
    if (this.transitionProgress < 1.0) {
      this.transitionProgress = Math.min(1.0, this.transitionProgress + dt / this.transitionDuration);
      interpolateAtmosphere(
        this.currentAtmo,
        this.fromAtmo,
        this.toAtmo,
        this.transitionProgress
      );
      this.syncUniformsFromAtmosphere();
    }

    // 2. Update OrbitControls + Camera Ground Clearance + Smooth Parallax Breathing
    this.removeParallaxFromCamera();

    if (this.isResettingCamera) {
      this.resetProgress = Math.min(1.0, this.resetProgress + dt / 1.1);
      const ease = 1 - Math.pow(1 - this.resetProgress, 3);
      this.camera.position.lerpVectors(this.resetStartPos, this.defaultCamPos, ease);
      this.controls.target.lerpVectors(this.resetStartTarget, this.defaultCamTarget, ease);
      if (this.resetProgress >= 1.0) {
        this.isResettingCamera = false;
      }
    }

    this.controls.update();

    // Clamp target & camera strictly inside the undulating meadow above the flower canopy
    this.controls.target.x = THREE.MathUtils.clamp(this.controls.target.x, -18.0, 18.0);
    this.controls.target.z = THREE.MathUtils.clamp(this.controls.target.z, -18.0, 10.0);
    const minTargetY = getTerrainHeight(this.controls.target.x, this.controls.target.z) + 0.55;
    const maxTargetY = minTargetY + 1.45;
    this.controls.target.y = THREE.MathUtils.clamp(this.controls.target.y, minTargetY, maxTargetY);

    const camGroundY = getTerrainHeight(this.camera.position.x, this.camera.position.z);
    if (this.camera.position.y < camGroundY + 0.92) {
      this.camera.position.y = camGroundY + 0.92;
    }

    // Keep sky dome centered on camera so horizon never shifts parallax unnaturally
    this.skyDome.position.copy(this.camera.position);

    this.smoothedPointerNDC.lerp(
      this.pointerInsideViewport ? this.pointerNDC : new THREE.Vector2(0, 0),
      1.0 - Math.exp(-4.5 * dt)
    );
    this.reapplyParallaxToCamera();

    // 3. Raycast 3D pointer onto meadow & step Spring-Damper Cursor Brush Field
    const cursorHit = this.pointerInsideViewport
      ? this.intersectMeadowRay(this.pointerNDC, 0.32)
      : null;
    this.brushField.updateCursorHit(cursorHit, dt);
    this.brushField.step(dt);

    // 4. Step flower growth/unfurl/shed physics & nighttime fireflies
    const newlyOpened = this.floralSystem.update(dt, this.elapsedTime);
    if (newlyOpened > 0) {
      this.audio.triggerBloomChime((Math.random() - 0.5) * 0.8, 0.72);
    }

    this.fireflies.update(
      dt,
      this.elapsedTime,
      this.currentAtmo.fireflyVisibility,
      this.brushField.cursorActive,
      this.brushField.currentCursorWorld,
      this.brushField.cursorVelocityXZ
    );

    this.audio.update(this.brushField.cursorSpeed, this.currentAtmo.windStrength);

    // 5. Render through Photographic Depth-of-Field Bokeh + Restrained Bloom + ACES Filmic
    const focusDistance = THREE.MathUtils.clamp(
      this.camera.position.distanceTo(this.controls.target) * 0.92,
      5.5,
      14.5
    );
    this.postProcessor.render(
      focusDistance,
      this.currentAtmo.bloomStrength,
      this.currentAtmo.bloomThreshold
    );
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);

    window.removeEventListener('resize', this.handleResize);
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointermove', this.handlePointerMove);
    dom.removeEventListener('pointerdown', this.handlePointerDown);
    dom.removeEventListener('pointerup', this.handlePointerUp);
    dom.removeEventListener('pointerleave', this.handlePointerLeave);

    this.controls.dispose();
    this.brushField.dispose();
    this.floralSystem.dispose();
    this.fireflies.dispose();
    this.audio.dispose();

    this.skyDome.geometry.dispose();
    (this.skyDome.material as THREE.Material).dispose();
    this.terrainMesh.geometry.dispose();
    (this.terrainMesh.material as THREE.Material).dispose();
    this.grassMesh.geometry.dispose();
    (this.grassMesh.material as THREE.Material).dispose();

    this.postProcessor.dispose();
    this.renderer.dispose();
    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}
