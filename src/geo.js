// Small 2D geometry helpers shared by map, physics and rules. No dependencies.
// World coordinates are metres: x = east, y = north. Angles are radians,
// measured counter-clockwise from east (so 0 = east, PI/2 = north).

export const DEG = Math.PI / 180;
const EARTH_R = 6378137;

/** Local flat projection around a reference point. Accurate to centimetres within a few km. */
export function makeProjection(lat0, lon0) {
  const k = Math.cos(lat0 * DEG);
  return {
    lat0,
    lon0,
    toXY(lat, lon) {
      return { x: (lon - lon0) * DEG * EARTH_R * k, y: (lat - lat0) * DEG * EARTH_R };
    },
    toLatLon(x, y) {
      return { lat: lat0 + y / EARTH_R / DEG, lon: lon0 + x / (EARTH_R * k) / DEG };
    },
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Closest point on segment a-b to p. t is 0 at a and 1 at b. */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { dist: Math.hypot(px - cx, py - cy), t, cx, cy };
}

export function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Deterministic pseudo-random generator (mulberry32) so the world looks the same every run. */
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
