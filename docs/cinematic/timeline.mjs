/**
 * Cinematic memory journey: deterministic positions, no API or commerce side effects.
 * Seconds are sequence-local, 0..16. Units are Three.js world units.
 */
export const INTRO_DURATION = 16;
export function clamp(x, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));
}
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export function mix(a, b, t) {
  return a + (b - a) * clamp(t);
}
function bezier3(a,b,c,d,t) {
  const s=1-t; return s*s*s*a+3*s*s*t*b+3*s*t*t*c+t*t*t*d;
}
export function journeyAt(seconds) {
  const t = clamp(seconds, 0, INTRO_DURATION);
  const emerge = smoothstep(2.2, 4.8, t);
  const clouds = smoothstep(4.3, 7, t) * (1 - smoothstep(9.2, 12, t));
  const page = smoothstep(9, 13, t);
  const settle = smoothstep(11.4, 13.2, t);
  const orbFlight = smoothstep(3.6, 11.9, t);
  const u = clamp((t - 3.6) / 8.3);
  const orb = [
    bezier3(-1.9, -0.9, 0.45, 0.05, u),
    bezier3(0.35, 1.45, 1.15, -0.48, u),
    bezier3(-1.15, 0.8, 2.15, 0.58, u)
  ];
  return {
    time: t,
    stage: t < 3.6 ? 0 : t < 8.6 ? 1 : t < 12.6 ? 2 : 3,
    train: 1 - smoothstep(4.3, 7.4, t),
    gather: smoothstep(0.6, 4.8, t),
    clouds, page,
    bookOpen: smoothstep(9.4, 12.3, t),
    landing: settle,
    orbFlight, orb,
    orbScale: (0.55 + 0.4 * emerge) * (1 - 0.62 * settle),
    ripple: smoothstep(12, 12.6, t) * (1 - smoothstep(13.4, 15.2, t)),
    cameraZ: 9.6 - 1.4 * smoothstep(5, 8, t) + 1.1 * smoothstep(10, 13, t)
  };
}
