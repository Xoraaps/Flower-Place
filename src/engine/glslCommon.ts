/**
 * Shared GLSL library for Field 01:
 * - 2D Simplex Noise (snoise)
 * - Layered Botanical Meadow Wind Waves
 * - Spring-Damper Cursor Brush Field Lookup
 * - Sun-Aware Exponential Squared Atmospheric Haze (FogExp2 + Mie forward scatter)
 */

export const GLSL_SIMPLEX_2D = /* glsl */ `
vec3 mod289_2(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289_2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute_2(vec3 x) { return mod289_2(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,  // (3.0-sqrt(3.0))/6.0
    0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
   -0.577350269189626,  // -1.0 + 2.0 * C.x
    0.024390243902439   // 1.0 / 41.0
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289_2(i);
  vec3 p = permute_2(permute_2(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;

export const GLSL_MEADOW_WIND = /* glsl */ `
struct WindSample {
  vec2 offsetXZ;
  float gust;
  float flutter;
};

WindSample sampleMeadowWind(vec2 worldXZ, float time, float phaseSeed, float windStrength) {
  // Primary prevailing breeze direction (gently diagonal across the field)
  vec2 windDir = normalize(vec2(0.84, 0.54));
  vec2 crossDir = vec2(-windDir.y, windDir.x);

  // Macro rolling wind waves travelling visibly across the meadow
  float macroWave = snoise(worldXZ * 0.048 - windDir * time * 0.58);
  float midGust   = snoise(worldXZ * 0.135 - windDir * time * 0.95 + vec2(3.7, -2.1));

  // Normalize gust envelope so gusts press stems smoothly in prevailing breeze with gentle return
  float gustEnvelope = (macroWave * 0.55 + midGust * 0.35 + 0.32) * windStrength;
  float crossSway = snoise(worldXZ * 0.11 + crossDir * time * 0.42 + phaseSeed) * 0.22 * windStrength;

  // High-frequency botanical tip flutter
  float flutter = sin(time * 3.6 + phaseSeed * 6.28318 + worldXZ.x * 1.3 + worldXZ.y * 0.9)
                * (0.5 + 0.5 * abs(midGust));

  WindSample ws;
  ws.offsetXZ = windDir * gustEnvelope + crossDir * crossSway;
  ws.gust = clamp(macroWave * 0.5 + 0.5, 0.0, 1.0);
  ws.flutter = flutter;
  return ws;
}
`;

export const GLSL_BRUSH_SAMPLER = /* glsl */ `
uniform sampler2D uBrushMap;
uniform vec4 uBrushBounds; // (minX, minZ, invSizeX, invSizeZ)

vec3 sampleCursorBrush(vec2 worldXZ) {
  vec2 uv = (worldXZ - uBrushBounds.xy) * uBrushBounds.zw;
  // Smoothly fade brush influence near simulation boundary
  vec2 edgeFade = smoothstep(vec2(0.0), vec2(0.06), uv) * (1.0 - smoothstep(vec2(0.94), vec2(1.0), uv));
  float mask = edgeFade.x * edgeFade.y;
  if (mask <= 0.0001) return vec3(0.0);

  vec4 raw = texture2D(uBrushMap, clamp(uv, 0.0, 1.0));
  // R, G encode signed XZ displacement in [-1..1] around 128/255 (= 0.5019608)
  vec2 dispXZ = (raw.rg - (128.0 / 255.0)) * 2.0 * 1.45 * mask;
  // B encodes downward press intensity [0..1]
  float pressDown = raw.b * mask;
  return vec3(dispXZ.x, pressDown, dispXZ.y);
}
`;

export const GLSL_ATMOSPHERE_FOG = /* glsl */ `
uniform vec3 uFogColor;
uniform vec3 uSunGlowFogColor;
uniform float uFogDensity;
uniform vec3 uSunDir;

vec3 applyMeadowAerialPerspective(vec3 baseColor, vec3 worldPos, vec3 camPos) {
  vec3 toFrag = worldPos - camPos;
  float dist = length(toFrag);
  vec3 viewDir = toFrag / max(dist, 0.0001);

  // Exponential squared fog (FogExp2)
  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  fogFactor = clamp(fogFactor, 0.0, 1.0);

  // Warm forward solar Mie scattering in haze when looking toward low sun
  float sunAlign = max(dot(viewDir, normalize(uSunDir)), 0.0);
  float mieScatter = pow(sunAlign, 5.0) * 0.65 + pow(sunAlign, 1.6) * 0.20;
  vec3 tintedFog = mix(uFogColor, uSunGlowFogColor, clamp(mieScatter, 0.0, 0.85));

  return mix(baseColor, tintedFog, fogFactor);
}
`;
