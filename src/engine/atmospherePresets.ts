import * as THREE from 'three';
import { TimeOfDay } from '../types/meadow';

export interface AtmosphereState {
  skyZenith: THREE.Color;
  skyMid: THREE.Color;
  skyHorizon: THREE.Color;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  skyLightColor: THREE.Color;
  groundBounceColor: THREE.Color;
  ambientIntensity: number;
  fogColor: THREE.Color;
  sunGlowFogColor: THREE.Color;
  fogDensity: number;
  exposure: number;
  windStrength: number;
  translucency: number;
  dewiness: number;
  nightFactor: number;
  fireflyVisibility: number;
  bloomStrength: number;
  bloomThreshold: number;
}

function makeSunDir(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    -Math.cos(az) * Math.cos(el)
  ).normalize();
}

export const ATMOSPHERE_PRESETS: Record<TimeOfDay, AtmosphereState> = {
  // 06:00 MORNING — Cool misty slate-peach sunrise, low eastern golden-pink light, crisp dew
  morning: {
    skyZenith: new THREE.Color('#6D86A1'),
    skyMid: new THREE.Color('#ACBAC8'),
    skyHorizon: new THREE.Color('#DFC6B8'),
    sunDir: makeSunDir(72, 14.0),
    sunColor: new THREE.Color('#FFCBA8'),
    sunIntensity: 1.38,
    skyLightColor: new THREE.Color('#9AB2CC'),
    groundBounceColor: new THREE.Color('#394420'),
    ambientIntensity: 0.66,
    fogColor: new THREE.Color('#C4CED6'),
    sunGlowFogColor: new THREE.Color('#E3C7B2'),
    fogDensity: 0.0118,
    exposure: 0.96,
    windStrength: 0.78,
    translucency: 0.78,
    dewiness: 0.92,
    nightFactor: 0.0,
    fireflyVisibility: 0.0,
    bloomStrength: 0.18,
    bloomThreshold: 1.15,
  },

  // 12:00 NOON — Clear cerulean sky, high overhead sun, saturated floral drifts, deep grass-bed shadows
  noon: {
    skyZenith: new THREE.Color('#4B7FB2'),
    skyMid: new THREE.Color('#8FB3D6'),
    skyHorizon: new THREE.Color('#CBD9E6'),
    sunDir: makeSunDir(18, 64.0),
    sunColor: new THREE.Color('#FFF6E5'),
    sunIntensity: 1.56,
    skyLightColor: new THREE.Color('#A8C6E4'),
    groundBounceColor: new THREE.Color('#3E4A1E'),
    ambientIntensity: 0.64,
    fogColor: new THREE.Color('#BFCEDE'),
    sunGlowFogColor: new THREE.Color('#D8D8D2'),
    fogDensity: 0.0082,
    exposure: 0.95,
    windStrength: 0.92,
    translucency: 0.52,
    dewiness: 0.26,
    nightFactor: 0.0,
    fireflyVisibility: 0.0,
    bloomStrength: 0.14,
    bloomThreshold: 1.18,
  },

  // 17:30 AFTERNOON (Default Golden Hour) — Warm amber raking side-back sunlight, glowing papery
  // poppy petals, dusty slate-gold distant mountain haze (matched directly to reference photograph)
  afternoon: {
    skyZenith: new THREE.Color('#7C93AB'),
    skyMid: new THREE.Color('#B1BEC9'),
    skyHorizon: new THREE.Color('#D8CFC2'),
    sunDir: makeSunDir(-66, 18.5), // Raking golden side-back light across the field
    sunColor: new THREE.Color('#FFC880'),
    sunIntensity: 1.55,
    skyLightColor: new THREE.Color('#B2BCC8'),
    groundBounceColor: new THREE.Color('#4A451E'),
    ambientIntensity: 0.62,
    fogColor: new THREE.Color('#BFBFC2'),
    sunGlowFogColor: new THREE.Color('#E3C598'),
    fogDensity: 0.0102,
    exposure: 0.97,
    windStrength: 1.0,
    translucency: 0.96,
    dewiness: 0.42,
    nightFactor: 0.0,
    fireflyVisibility: 0.0,
    bloomStrength: 0.20,
    bloomThreshold: 1.12,
  },

  // 23:00 NIGHT — Deep Prussian blue to obsidian starry sky dome, silver-blue moonlight,
  // nocturnal mist, and warm chartreuse-gold bioluminescent fireflies
  night: {
    skyZenith: new THREE.Color('#040914'),
    skyMid: new THREE.Color('#09162B'),
    skyHorizon: new THREE.Color('#13253E'),
    sunDir: makeSunDir(32, 30.0), // Moon direction
    sunColor: new THREE.Color('#8FB6E0'),
    sunIntensity: 0.58,
    skyLightColor: new THREE.Color('#284166'),
    groundBounceColor: new THREE.Color('#0B141A'),
    ambientIntensity: 0.46,
    fogColor: new THREE.Color('#0B1728'),
    sunGlowFogColor: new THREE.Color('#1A304E'),
    fogDensity: 0.0142,
    exposure: 1.0,
    windStrength: 0.65,
    translucency: 0.45,
    dewiness: 0.62,
    nightFactor: 1.0,
    fireflyVisibility: 1.0,
    bloomStrength: 0.34,
    bloomThreshold: 0.72,
  },
};

export function cloneAtmosphereState(src: AtmosphereState): AtmosphereState {
  return {
    skyZenith: src.skyZenith.clone(),
    skyMid: src.skyMid.clone(),
    skyHorizon: src.skyHorizon.clone(),
    sunDir: src.sunDir.clone(),
    sunColor: src.sunColor.clone(),
    sunIntensity: src.sunIntensity,
    skyLightColor: src.skyLightColor.clone(),
    groundBounceColor: src.groundBounceColor.clone(),
    ambientIntensity: src.ambientIntensity,
    fogColor: src.fogColor.clone(),
    sunGlowFogColor: src.sunGlowFogColor.clone(),
    fogDensity: src.fogDensity,
    exposure: src.exposure,
    windStrength: src.windStrength,
    translucency: src.translucency,
    dewiness: src.dewiness,
    nightFactor: src.nightFactor,
    fireflyVisibility: src.fireflyVisibility,
    bloomStrength: src.bloomStrength,
    bloomThreshold: src.bloomThreshold,
  };
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function interpolateAtmosphere(
  out: AtmosphereState,
  from: AtmosphereState,
  to: AtmosphereState,
  rawT: number
): void {
  const t = easeInOutCubic(Math.max(0, Math.min(1, rawT)));

  out.skyZenith.lerpColors(from.skyZenith, to.skyZenith, t);
  out.skyMid.lerpColors(from.skyMid, to.skyMid, t);
  out.skyHorizon.lerpColors(from.skyHorizon, to.skyHorizon, t);

  out.sunDir.lerpVectors(from.sunDir, to.sunDir, t).normalize();
  out.sunColor.lerpColors(from.sunColor, to.sunColor, t);
  out.sunIntensity = THREE.MathUtils.lerp(from.sunIntensity, to.sunIntensity, t);

  out.skyLightColor.lerpColors(from.skyLightColor, to.skyLightColor, t);
  out.groundBounceColor.lerpColors(from.groundBounceColor, to.groundBounceColor, t);
  out.ambientIntensity = THREE.MathUtils.lerp(from.ambientIntensity, to.ambientIntensity, t);

  out.fogColor.lerpColors(from.fogColor, to.fogColor, t);
  out.sunGlowFogColor.lerpColors(from.sunGlowFogColor, to.sunGlowFogColor, t);
  out.fogDensity = THREE.MathUtils.lerp(from.fogDensity, to.fogDensity, t);

  out.exposure = THREE.MathUtils.lerp(from.exposure, to.exposure, t);
  out.windStrength = THREE.MathUtils.lerp(from.windStrength, to.windStrength, t);
  out.translucency = THREE.MathUtils.lerp(from.translucency, to.translucency, t);
  out.dewiness = THREE.MathUtils.lerp(from.dewiness, to.dewiness, t);
  out.nightFactor = THREE.MathUtils.lerp(from.nightFactor, to.nightFactor, t);
  out.fireflyVisibility = THREE.MathUtils.lerp(from.fireflyVisibility, to.fireflyVisibility, t);
  out.bloomStrength = THREE.MathUtils.lerp(from.bloomStrength, to.bloomStrength, t);
  out.bloomThreshold = THREE.MathUtils.lerp(from.bloomThreshold, to.bloomThreshold, t);
}
