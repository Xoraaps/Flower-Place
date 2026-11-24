import * as THREE from 'three';

/**
 * Real-time 2D Spring-Damper Cursor Brush Field (128x128 DataTexture).
 * Encodes persistent directional stem/grass parting and rebound along the
 * 3D cursor's path across the meadow so dragging the pointer feels like
 * running a hand through tall wild grass and poppies.
 */
export class CursorBrushField {
  public readonly size = 128;
  public readonly bounds: THREE.Vector4;
  public readonly texture: THREE.DataTexture;

  // World-space simulation domain covering foreground & focal meadow
  private readonly minX = -22.0;
  private readonly maxX = 22.0;
  private readonly minZ = -22.0;
  private readonly maxZ = 16.0;

  private readonly dispX: Float32Array;
  private readonly dispZ: Float32Array;
  private readonly velX: Float32Array;
  private readonly velZ: Float32Array;
  private readonly press: Float32Array;
  private readonly pressVel: Float32Array;
  private readonly texBytes: Uint8Array;

  private hasPrevCursor = false;
  private readonly prevCursorXZ = new THREE.Vector2();
  public readonly currentCursorWorld = new THREE.Vector3(0, -100, 0);
  public readonly cursorVelocityXZ = new THREE.Vector2(0, 0);
  public cursorSpeed = 0;
  public cursorActive = false;

  constructor() {
    const cells = this.size * this.size;
    this.dispX = new Float32Array(cells);
    this.dispZ = new Float32Array(cells);
    this.velX = new Float32Array(cells);
    this.velZ = new Float32Array(cells);
    this.press = new Float32Array(cells);
    this.pressVel = new Float32Array(cells);
    this.texBytes = new Uint8Array(cells * 4);

    // Initialize neutral zero displacement (128/255 in RG)
    for (let i = 0; i < cells; i++) {
      this.texBytes[i * 4 + 0] = 128;
      this.texBytes[i * 4 + 1] = 128;
      this.texBytes[i * 4 + 2] = 0;
      this.texBytes[i * 4 + 3] = 255;
    }

    this.bounds = new THREE.Vector4(
      this.minX,
      this.minZ,
      1.0 / (this.maxX - this.minX),
      1.0 / (this.maxZ - this.minZ)
    );

    this.texture = new THREE.DataTexture(
      this.texBytes,
      this.size,
      this.size,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  public updateCursorHit(hitPoint: THREE.Vector3 | null, dt: number): void {
    const safeDt = Math.max(0.004, Math.min(dt, 0.05));

    if (!hitPoint) {
      this.cursorActive = false;
      this.hasPrevCursor = false;
      this.cursorSpeed *= 0.85;
      this.cursorVelocityXZ.multiplyScalar(0.85);
      return;
    }

    this.cursorActive = true;
    this.currentCursorWorld.copy(hitPoint);

    if (!this.hasPrevCursor) {
      this.prevCursorXZ.set(hitPoint.x, hitPoint.z);
      this.hasPrevCursor = true;
      return;
    }

    const dx = hitPoint.x - this.prevCursorXZ.x;
    const dz = hitPoint.z - this.prevCursorXZ.y;
    const moveDist = Math.hypot(dx, dz);

    const instVx = dx / safeDt;
    const instVz = dz / safeDt;
    this.cursorVelocityXZ.lerp(new THREE.Vector2(instVx, instVz), 0.35);
    this.cursorSpeed = Math.min(18.0, this.cursorVelocityXZ.length());

    // Sub-step along cursor stroke so rapid hand sweeps leave a continuous parted furrow
    const steps = Math.min(10, Math.max(1, Math.ceil(moveDist / 0.28)));
    const moveDirX = moveDist > 0.001 ? dx / moveDist : 0;
    const moveDirZ = moveDist > 0.001 ? dz / moveDist : 0;
    const dragFactor = Math.min(1.0, moveDist / 0.18);

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const sx = this.prevCursorXZ.x + dx * t;
      const sz = this.prevCursorXZ.y + dz * t;
      this.stampBrushImpulse(sx, sz, moveDirX, moveDirZ, dragFactor, safeDt / steps);
    }

    this.prevCursorXZ.set(hitPoint.x, hitPoint.z);
  }

  private stampBrushImpulse(
    wx: number,
    wz: number,
    dirX: number,
    dirZ: number,
    dragStrength: number,
    stepDt: number
  ): void {
    const brushRadius = 1.65;
    const cellW = (this.maxX - this.minX) / this.size;
    const cellD = (this.maxZ - this.minZ) / this.size;

    const cx = (wx - this.minX) / cellW;
    const cz = (wz - this.minZ) / cellD;
    const rx = Math.ceil(brushRadius / cellW);
    const rz = Math.ceil(brushRadius / cellD);

    const ixMin = Math.max(0, Math.floor(cx - rx));
    const ixMax = Math.min(this.size - 1, Math.ceil(cx + rx));
    const izMin = Math.max(0, Math.floor(cz - rz));
    const izMax = Math.min(this.size - 1, Math.ceil(cz + rz));

    for (let iz = izMin; iz <= izMax; iz++) {
      const cellWorldZ = this.minZ + (iz + 0.5) * cellD;
      const oz = cellWorldZ - wz;

      for (let ix = ixMin; ix <= ixMax; ix++) {
        const cellWorldX = this.minX + (ix + 0.5) * cellW;
        const ox = cellWorldX - wx;
        const dist = Math.hypot(ox, oz);
        if (dist >= brushRadius) continue;

        const falloff = Math.pow(1.0 - dist / brushRadius, 1.8);
        const invDist = dist > 0.02 ? 1.0 / dist : 0.0;

        // Combine radial parting (pushing stems aside around hand) + forward combing drag
        const radialX = ox * invDist;
        const radialZ = oz * invDist;

        const forceX = (radialX * 0.62 + dirX * 0.88 * dragStrength) * falloff * 24.0;
        const forceZ = (radialZ * 0.62 + dirZ * 0.88 * dragStrength) * falloff * 24.0;

        const idx = iz * this.size + ix;
        this.velX[idx] += forceX * stepDt;
        this.velZ[idx] += forceZ * stepDt;
        this.pressVel[idx] += falloff * (5.5 + dragStrength * 9.0) * stepDt;
      }
    }
  }

  /**
   * Soft outward botanical ripple when clicking to sow a cluster on the field.
   */
  public injectRadialPulse(wx: number, wz: number, strength = 1.0): void {
    const radius = 2.1;
    const cellW = (this.maxX - this.minX) / this.size;
    const cellD = (this.maxZ - this.minZ) / this.size;

    const cx = (wx - this.minX) / cellW;
    const cz = (wz - this.minZ) / cellD;
    const rx = Math.ceil(radius / cellW);
    const rz = Math.ceil(radius / cellD);

    const ixMin = Math.max(0, Math.floor(cx - rx));
    const ixMax = Math.min(this.size - 1, Math.ceil(cx + rx));
    const izMin = Math.max(0, Math.floor(cz - rz));
    const izMax = Math.min(this.size - 1, Math.ceil(cz + rz));

    for (let iz = izMin; iz <= izMax; iz++) {
      const oz = this.minZ + (iz + 0.5) * cellD - wz;
      for (let ix = ixMin; ix <= ixMax; ix++) {
        const ox = this.minX + (ix + 0.5) * cellW - wx;
        const dist = Math.hypot(ox, oz);
        if (dist >= radius || dist < 0.02) continue;

        const wave = Math.sin((dist / radius) * Math.PI) * strength;
        const idx = iz * this.size + ix;
        this.velX[idx] += (ox / dist) * wave * 2.8;
        this.velZ[idx] += (oz / dist) * wave * 2.8;
        this.pressVel[idx] += wave * 1.6;
      }
    }
  }

  /**
   * Advances underdamped spring-damper physics across all 16,384 field cells
   * and uploads the compact 64KB displacement map when active.
   */
  public step(dt: number): void {
    const safeDt = Math.min(dt, 0.045);
    // Tuned Hooke's spring stiffness & damping for realistic botanical stem recovery
    const stiffness = 14.5;
    const damping = 3.85;

    const cells = this.size * this.size;
    let activeEnergy = 0;

    for (let i = 0; i < cells; i++) {
      let dx = this.dispX[i];
      let dz = this.dispZ[i];
      let vx = this.velX[i];
      let vz = this.velZ[i];
      let p = this.press[i];
      let pv = this.pressVel[i];

      if (
        Math.abs(dx) < 0.0005 &&
        Math.abs(dz) < 0.0005 &&
        Math.abs(vx) < 0.0005 &&
        Math.abs(vz) < 0.0005 &&
        p < 0.0005 &&
        Math.abs(pv) < 0.0005
      ) {
        continue;
      }

      activeEnergy++;

      const ax = -stiffness * dx - damping * vx;
      const az = -stiffness * dz - damping * vz;
      vx += ax * safeDt;
      vz += az * safeDt;
      dx = clampSym(dx + vx * safeDt, 1.0);
      dz = clampSym(dz + vz * safeDt, 1.0);

      const ap = -16.0 * p - 4.6 * pv;
      pv += ap * safeDt;
      p = Math.max(0.0, Math.min(1.0, p + pv * safeDt));

      this.dispX[i] = dx;
      this.dispZ[i] = dz;
      this.velX[i] = vx;
      this.velZ[i] = vz;
      this.press[i] = p;
      this.pressVel[i] = pv;

      this.texBytes[i * 4 + 0] = Math.round(128 + dx * 127);
      this.texBytes[i * 4 + 1] = Math.round(128 + dz * 127);
      this.texBytes[i * 4 + 2] = Math.round(p * 255);
    }

    if (activeEnergy > 0) {
      this.texture.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.texture.dispose();
  }
}

function clampSym(v: number, limit: number): number {
  return v < -limit ? -limit : v > limit ? limit : v;
}
