import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

/**
 * Single-pass hardware DepthTexture Photographic Bokeh Pass.
 * Unlike Three.js's built-in BokehPass (which re-renders the scene with MeshDepthMaterial
 * and breaks custom InstancedMesh vertex wind/growth shaders), this pass reads the exact
 * hardware DepthTexture written during RenderPass and performs a 24-tap Golden-Angle
 * Vogel Disk optical Circle-of-Confusion gather:
 *  - Immediate foreground blooms (< 4.8m) soften into creamy foreground blur
 *  - Focal meadow plane (~6m .. 14m) stays razor-sharp
 *  - Distant hills & horizon silhouettes (> 28m) melt into soft photographic lens blur
 */
class PhotographicBokehPass extends Pass {
  public readonly uniforms: Record<string, THREE.IUniform>;
  private readonly material: THREE.ShaderMaterial;
  private readonly fsQuad: FullScreenQuad;

  constructor(camera: THREE.PerspectiveCamera) {
    super();

    this.uniforms = {
      tColor: { value: null },
      tDepth: { value: null },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uFocusDistance: { value: 8.6 },
      uFocalRange: { value: 4.2 },
      uMaxForegroundBlur: { value: 0.0058 },
      uMaxBackgroundBlur: { value: 0.0038 },
      uAspect: { value: camera.aspect },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform float uNear;
        uniform float uFar;
        uniform float uFocusDistance;
        uniform float uFocalRange;
        uniform float uMaxForegroundBlur;
        uniform float uMaxBackgroundBlur;
        uniform float uAspect;

        varying vec2 vUv;

        float getLinearDepth(vec2 uv) {
          float fragCoordZ = texture2D(tDepth, uv).x;
          float viewZ = (uNear * uFar) / ((uFar - uNear) * fragCoordZ - uFar);
          return -viewZ;
        }

        float computeCoC(float linearDist) {
          // Foreground blur when closer than focal window
          float nearEdge = uFocusDistance - uFocalRange * 0.48;
          if (linearDist < nearEdge) {
            float fgT = clamp((nearEdge - linearDist) / max(nearEdge - 0.6, 0.5), 0.0, 1.0);
            return -pow(fgT, 1.25) * uMaxForegroundBlur;
          }
          // Background blur beyond focal window
          float farEdge = uFocusDistance + uFocalRange * 1.15;
          if (linearDist > farEdge) {
            float bgT = clamp((linearDist - farEdge) / 58.0, 0.0, 1.0);
            return pow(bgT, 0.92) * uMaxBackgroundBlur;
          }
          return 0.0;
        }

        void main() {
          vec4 centerColor = texture2D(tColor, vUv);
          float centerDist = getLinearDepth(vUv);
          float centerCoC = computeCoC(centerDist);
          float absCenterCoC = abs(centerCoC);

          // Fast exit for pixels tightly inside the razor-sharp focal plane,
          // while still allowing soft foreground out-of-focus petals to bleed gently
          vec3 accum = centerColor.rgb;
          float totalWeight = 1.0;

          // 22-tap Golden-Angle Vogel Spiral disk gather
          const int TAPS = 22;
          const float GOLDEN_ANGLE = 2.39996323;

          // Probe max radius allows foreground bokeh overlap onto sharp mid-field
          float searchRadius = max(absCenterCoC, uMaxForegroundBlur * 0.65);

          if (searchRadius > 0.00025) {
            for (int i = 0; i < TAPS; i++) {
              float fi = float(i) + 0.5;
              float rNorm = sqrt(fi / float(TAPS));
              float theta = fi * GOLDEN_ANGLE;

              vec2 dir = vec2(cos(theta) / uAspect, sin(theta));
              vec2 sampleUv = clamp(vUv + dir * (rNorm * searchRadius), vec2(0.001), vec2(0.999));

              float sampleDist = getLinearDepth(sampleUv);
              float sampleCoC = computeCoC(sampleDist);
              float absSampleCoC = abs(sampleCoC);

              // Prevent sharp closer stems from bleeding onto far background blur,
              // while allowing blurred closer foreground blooms (sampleCoC < 0) to overlap cleanly
              float radiusNeeded = rNorm * searchRadius;
              float validGather = smoothstep(radiusNeeded * 0.72, radiusNeeded * 1.15 + 0.0004, absSampleCoC);
              float depthGuard = sampleDist < centerDist - 0.35
                ? smoothstep(0.0005, 0.0022, -sampleCoC) // foreground bokeh overlap
                : 1.0;

              vec3 sCol = texture2D(tColor, sampleUv).rgb;
              // Gentle highlight boost for creamy specular optical bokeh discs
              float luma = dot(sCol, vec3(0.2126, 0.7152, 0.0722));
              float bokehHighlight = 1.0 + smoothstep(0.85, 2.2, luma) * 0.35;

              float w = validGather * depthGuard * bokehHighlight;
              accum += sCol * w;
              totalWeight += w;
            }
          }

          gl_FragColor = vec4(accum / totalWeight, 1.0);
        }
      `,
    });

    this.fsQuad = new FullScreenQuad(this.material);
  }

  public updateCamera(camera: THREE.PerspectiveCamera, focusDistance: number): void {
    this.uniforms.uNear.value = camera.near;
    this.uniforms.uFar.value = camera.far;
    this.uniforms.uAspect.value = camera.aspect;
    this.uniforms.uFocusDistance.value = focusDistance;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    this.uniforms.tColor.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
      this.fsQuad.render(renderer);
    }
  }

  override dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

export class MeadowPostProcessor {
  public readonly composer: EffectComposer;
  public readonly bokehPass: PhotographicBokehPass;
  public readonly bloomPass: UnrealBloomPass;
  private readonly fxaaPass: ShaderPass;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number
  ) {
    this.renderer = renderer;
    this.camera = camera;

    const dpr = renderer.getPixelRatio();
    const rtWidth = Math.max(1, Math.floor(width * dpr));
    const rtHeight = Math.max(1, Math.floor(height * dpr));

    const rt1 = this.createDepthRenderTarget(rtWidth, rtHeight);
    this.composer = new EffectComposer(renderer, rt1);
    // Ensure rt2 has its own independent DepthTexture attachment
    this.composer.renderTarget2.depthTexture = new THREE.DepthTexture(
      rtWidth,
      rtHeight,
      THREE.UnsignedIntType
    );

    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    this.bokehPass = new PhotographicBokehPass(camera);
    this.composer.addPass(this.bokehPass);

    // Restrained UnrealBloomPass: high threshold so only sunlit petal rims & fireflies glow
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(rtWidth, rtHeight),
      0.24,
      0.52,
      0.87
    );
    this.composer.addPass(this.bloomPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    this.fxaaPass = new ShaderPass(FXAAShader);
    this.fxaaPass.material.uniforms['resolution'].value.set(1 / rtWidth, 1 / rtHeight);
    this.composer.addPass(this.fxaaPass);
  }

  private createDepthRenderTarget(w: number, h: number): THREE.WebGLRenderTarget {
    const depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;

    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      depthTexture,
    });
  }

  public setSize(width: number, height: number): void {
    const dpr = this.renderer.getPixelRatio();
    const rtW = Math.max(1, Math.floor(width * dpr));
    const rtH = Math.max(1, Math.floor(height * dpr));

    this.composer.setSize(width, height);

    if (this.composer.renderTarget1.depthTexture) {
      this.composer.renderTarget1.depthTexture.dispose();
    }
    if (this.composer.renderTarget2.depthTexture) {
      this.composer.renderTarget2.depthTexture.dispose();
    }
    this.composer.renderTarget1.depthTexture = new THREE.DepthTexture(
      rtW,
      rtH,
      THREE.UnsignedIntType
    );
    this.composer.renderTarget2.depthTexture = new THREE.DepthTexture(
      rtW,
      rtH,
      THREE.UnsignedIntType
    );

    this.bloomPass.resolution.set(rtW, rtH);
    this.fxaaPass.material.uniforms['resolution'].value.set(1 / rtW, 1 / rtH);
    this.bokehPass.updateCamera(this.camera, this.bokehPass.uniforms.uFocusDistance.value);
  }

  public render(focusDistance: number, bloomStrength: number, bloomThreshold: number): void {
    this.bokehPass.updateCamera(this.camera, focusDistance);
    this.bloomPass.strength = bloomStrength;
    this.bloomPass.threshold = bloomThreshold;
    this.composer.render();
  }

  public dispose(): void {
    this.bokehPass.dispose();
    this.bloomPass.dispose();
    this.composer.renderTarget1.depthTexture?.dispose();
    this.composer.renderTarget2.depthTexture?.dispose();
    this.composer.dispose();
  }
}
