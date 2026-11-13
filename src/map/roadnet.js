// Road network built from OpenStreetMap data. Pure logic, no rendering.
//
// Input:  the JSON that the Overpass API returns ({ elements: [...] }).
// Output: roads with geometry, speed limits and direction rules, junctions,
//         buildings, and fast "where am I?" lookups used by the physics and
//         the driving instructor.
//
// Known simplifications in this version: the world is flat (no hills, bridges
// are drawn at ground level), motorways and tunnels are left out.

import { makeProjection, distToSegment, pointInPolygon } from '../geo.js';

/** Road classes we can drive on. Widths in metres are used when OSM has no lane/width tag. */
export const ROAD_KINDS = {
  primary: { width: 7.5, center: true, sidewalk: true, label: 'Hovedvei' },
  secondary: { width: 7.0, center: true, sidewalk: true, label: 'Hovedvei' },
  tertiary: { width: 6.5, center: true, sidewalk: true, label: 'Samlevei' },
  unclassified: { width: 6.0, center: false, sidewalk: true, label: 'Vei' },
  residential: { width: 5.5, center: false, sidewalk: true, label: 'Boliggate' },
  living_street: { width: 4.5, center: false, sidewalk: false, label: 'Gatetun', defaultSpeed: 10 },
  service: { width: 4.0, center: false, sidewalk: false, label: 'Adkomstvei' },
};

const PATH_KINDS = new Set(['footway', 'path', 'cycleway', 'pedestrian', 'steps', 'track']);
const SKIPPED_KINDS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);
const CELL = 30; // metres, spatial grid cell size

function baseKind(kind) {
  return kind.endsWith('_link') ? kind.slice(0, -5) : kind;
}

function parseNumber(raw) {
  if (raw == null) return NaN;
  const n = parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function parseMaxspeed(tags, kindInfo) {
  const raw = tags.maxspeed;
  if (raw) {
    const n = parseNumber(raw);
    if (n > 0) return { value: /mph/.test(raw) ? Math.round(n * 1.609) : Math.round(n), source: 'skiltet' };
    if (/urban/.test(raw)) return { value: 50, source: 'tettbygd strøk' };
    if (/rural/.test(raw)) return { value: 80, source: 'utenfor tettbygd strøk' };
    if (/walk|living/.test(raw)) return { value: 10, source: 'gangfart' };
  }
  // Norwegian general limit in built-up areas is 50 km/h.
  return { value: kindInfo.defaultSpeed ?? 50, source: 'antatt' };
}

/** Roads the map says are closed to ordinary cars (bus streets, private access ...). */
function isRestricted(tags) {
  const closed = (v) => v === 'no' || v === 'private';
  for (const key of ['motorcar', 'motor_vehicle', 'vehicle']) {
    if (tags[key] != null) return closed(tags[key]);
  }
  return closed(tags.access) || tags.service === 'bus' || tags.bus === 'designated';
}

function cellKey(cx, cy) {
  return cx * 100003 + cy;
}

class Grid {
  constructor() {
    this.cells = new Map();
  }
  insert(minX, minY, maxX, maxY, item) {
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) {
        const k = cellKey(cx, cy);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
      }
    }
  }
  /** All items in the cell containing (x, y) and its eight neighbours. */
  near(x, y, out = []) {
    out.length = 0;
    const cx0 = Math.floor(x / CELL);
    const cy0 = Math.floor(y / CELL);
    for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
      for (let cy = cy0 - 1; cy <= cy0 + 1; cy++) {
        const list = this.cells.get(cellKey(cx, cy));
        if (list) for (const it of list) out.push(it);
      }
    }
    return out;
  }
}

function buildingHeight(tags) {
  const h = parseNumber(tags.height);
  if (h > 0) return h;
  const levels = parseNumber(tags['building:levels']);
  if (levels > 0) return levels * 3.1 + 1;
  switch (tags.building) {
    case 'garage':
    case 'garages':
    case 'shed':
    case 'carport':
    case 'roof':
      return 3;
    case 'house':
    case 'detached':
    case 'semidetached_house':
    case 'terrace':
    case 'cabin':
      return 6.5;
    case 'apartments':
    case 'residential':
      return 13;
    case 'retail':
    case 'commercial':
    case 'school':
    case 'kindergarten':
      return 8;
    default:
      return 9;
  }
}

/**
 * Build the road network.
 * @param osm  Overpass JSON
 * @param area { lat, lon } reference point; becomes (0, 0) in world metres
 */
export function buildRoadNet(osm, area) {
  const proj = makeProjection(area.lat, area.lon);
  const nodes = new Map();
  for (const el of osm.elements) {
    if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
      const p = proj.toXY(el.lat, el.lon);
      nodes.set(el.id, { id: el.id, x: p.x, y: p.y, tags: el.tags || null });
    }
  }

  const roads = [];
  const paths = [];
  const buildings = [];
  const skipped = { motorway: 0, tunnel: 0, broken: 0 };

  for (const el of osm.elements) {
    if (el.type !== 'way' || !el.tags || !Array.isArray(el.nodes)) continue;
    const tags = el.tags;
    const pts = [];
    for (const id of el.nodes) {
      const n = nodes.get(id);
      if (!n) continue;
      const last = pts[pts.length - 1];
      if (last && Math.hypot(last.x - n.x, last.y - n.y) < 0.05) continue;
      pts.push({ x: n.x, y: n.y, id });
    }

    if (tags.building && tags.building !== 'no') {
      if (pts.length >= 4 && pts[0].id === pts[pts.length - 1].id) {
        const ring = pts.slice(0, -1);
        buildings.push({ id: el.id, pts: ring, height: buildingHeight(tags), name: tags.name || '' });
      }
      continue;
    }

    const kind = tags.highway;
    if (!kind) continue;
    if (pts.length < 2) {
      skipped.broken++;
      continue;
    }
    if (tags.tunnel && tags.tunnel !== 'no') {
      skipped.tunnel++;
      continue;
    }
    if (parseNumber(tags.layer) < 0) {
      skipped.tunnel++;
      continue;
    }
    if (SKIPPED_KINDS.has(kind)) {
      skipped.motorway++;
      continue;
    }
    if (tags.area === 'yes') continue;

    if (PATH_KINDS.has(kind)) {
      paths.push({ id: el.id, kind, pts, width: kind === 'pedestrian' ? 4 : kind === 'cycleway' ? 3 : 2 });
      continue;
    }

    const info = ROAD_KINDS[baseKind(kind)];
    if (!info) continue; // construction, proposed, platform, ...

    const roundabout = tags.junction === 'roundabout' || tags.junction === 'circular';
    let oneway = roundabout || tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === 'true';
    if (tags.oneway === '-1') {
      pts.reverse();
      oneway = true;
    }
    const lanesTag = parseNumber(tags.lanes);
    const widthTag = parseNumber(tags.width);
    let width = info.width;
    if (widthTag >= 2.5 && widthTag <= 30) width = widthTag;
    else if (lanesTag >= 1) width = lanesTag * 3.25 + 0.5;
    else if (oneway) width = Math.min(info.width, 4.5);
    if (tags.service === 'driveway') width = Math.min(width, 3.2);
    if (tags.service === 'parking_aisle') width = Math.max(width, 5);
    const centerLine = !oneway && width >= 5.5 && (info.center || lanesTag >= 2);
    const speed = parseMaxspeed(tags, info);

    const road = {
      id: el.id,
      index: roads.length,
      kind,
      name: tags.name || '',
      label: tags.name || info.label,
      oneway,
      roundabout,
      restricted: isRestricted(tags),
      lanes: lanesTag >= 1 ? lanesTag : oneway ? 1 : 2,
      width,
      centerLine,
      sidewalk: info.sidewalk,
      maxspeed: speed.value,
      maxspeedSource: speed.source,
      pts,
      cum: [0],
      length: 0,
    };
    for (let i = 1; i < pts.length; i++) {
      road.length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      road.cum.push(road.length);
    }
    roads.push(road);
  }

  // --- Which roads meet at which node.
  const nodeRoads = new Map(); // nodeId -> [{ road, i }]
  const arms = new Map(); // nodeId -> number of road arms leaving the node
  for (const road of roads) {
    const last = road.pts.length - 1;
    road.pts.forEach((p, i) => {
      let list = nodeRoads.get(p.id);
      if (!list) nodeRoads.set(p.id, (list = []));
      list.push({ road, i });
      arms.set(p.id, (arms.get(p.id) || 0) + (i === 0 || i === last ? 1 : 2));
    });
  }

  const junctions = [];
  const junctionGrid = new Grid();
  for (const [id, count] of arms) {
    if (count < 3) continue;
    const n = nodes.get(id);
    const meeting = nodeRoads.get(id);
    const names = [...new Set(meeting.map((m) => m.road.name).filter(Boolean))];
    const j = {
      id,
      x: n.x,
      y: n.y,
      arms: count,
      radius: Math.max(...meeting.map((m) => m.road.width)) / 2,
      roundabout: meeting.some((m) => m.road.roundabout),
      name: names.length ? names.slice(0, 2).join(' / ') : 'kryss uten navn',
    };
    junctions.push(j);
    junctionGrid.insert(j.x, j.y, j.x, j.y, j);
  }

  // --- Spatial index of road segments.
  const segGrid = new Grid();
  for (const road of roads) {
    const m = road.width / 2 + 6;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const a = road.pts[i];
      const b = road.pts[i + 1];
      segGrid.insert(Math.min(a.x, b.x) - m, Math.min(a.y, b.y) - m, Math.max(a.x, b.x) + m, Math.max(a.y, b.y) + m, {
        road,
        i,
      });
    }
  }

  const buildingGrid = new Grid();
  for (const b of buildings) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of b.pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    b.bounds = { minX, minY, maxX, maxY };
    buildingGrid.insert(minX, minY, maxX, maxY, b);
  }

  // --- Point features.
  const crossings = [];
  const signals = [];
  const trees = [];
  for (const n of nodes.values()) {
    if (!n.tags) continue;
    if (n.tags.natural === 'tree') trees.push({ x: n.x, y: n.y });
    const hw = n.tags.highway;
    if (hw === 'crossing' || hw === 'traffic_signals') {
      const on = nodeRoads.get(n.id);
      if (!on) continue;
      const { road, i } = on[0];
      const a = road.pts[Math.max(0, i - 1)];
      const b = road.pts[Math.min(road.pts.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const item = { x: n.x, y: n.y, road, dirX: (b.x - a.x) / len, dirY: (b.y - a.y) / len };
      (hw === 'crossing' ? crossings : signals).push(item);
    }
  }

  const scratch = [];

  return {
    proj,
    roads,
    paths,
    buildings,
    junctions,
    crossings,
    signals,
    trees,
    nodeRoads,
    skipped,

    /**
     * Find the road the car is on.
     * heading: the car's direction of travel (radians). Used to pick the right
     *          road where several overlap, e.g. in a junction.
     * prevRoad: the road returned last time (gives a little "stickiness").
     * Returns null when no road is within about 30 m.
     */
    locate(x, y, heading, prevRoad = null) {
      const hx = Math.cos(heading);
      const hy = Math.sin(heading);
      let best = null;
      let bestScore = Infinity;
      let edgeDist = Infinity;
      for (const seg of segGrid.near(x, y, scratch)) {
        const a = seg.road.pts[seg.i];
        const b = seg.road.pts[seg.i + 1];
        const d = distToSegment(x, y, a.x, a.y, b.x, b.y);
        edgeDist = Math.min(edgeDist, d.dist - seg.road.width / 2);
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const dx = (b.x - a.x) / len;
        const dy = (b.y - a.y) / len;
        const cos = dx * hx + dy * hy;
        const score = d.dist + (1 - Math.abs(cos)) * 6 - (seg.road === prevRoad ? 1.5 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = { seg, d, dx, dy, cos, len };
        }
      }
      if (!best) return null;
      const { seg, d, dx, dy, cos, len } = best;
      const a = seg.road.pts[seg.i];
      return {
        road: seg.road,
        segIndex: seg.i,
        dist: d.dist,
        // signed distance from the centre line: positive = left of the road's own direction
        lateral: (x - a.x) * -dy + (y - a.y) * dx,
        along: cos >= 0 ? 1 : -1, // +1 = travelling in the road's own direction
        s: seg.road.cum[seg.i] + d.t * len,
        dirX: dx,
        dirY: dy,
        edgeDist, // > 0 means outside every road surface by this many metres
      };
    },

    nearestJunction(x, y) {
      let best = null;
      let bestDist = Infinity;
      for (const j of junctionGrid.near(x, y, scratch)) {
        const d = Math.hypot(j.x - x, j.y - y);
        if (d < bestDist) {
          bestDist = d;
          best = j;
        }
      }
      return best ? { junction: best, dist: bestDist } : null;
    },

    buildingAt(x, y) {
      for (const b of buildingGrid.near(x, y, scratch)) {
        const bb = b.bounds;
        if (x < bb.minX || x > bb.maxX || y < bb.minY || y > bb.maxY) continue;
        if (pointInPolygon(x, y, b.pts)) return b;
      }
      return null;
    },

    /** A sensible place to start: on an ordinary street close to the centre of the area. */
    findSpawn() {
      const preferred = new Set(['tertiary', 'secondary', 'residential', 'unclassified']);
      let best = null;
      for (const pass of [0, 1]) {
        for (const road of roads) {
          if (road.roundabout || road.restricted) continue;
          if (pass === 0 && (!preferred.has(road.kind) || road.length < 60)) continue;
          for (let i = 0; i < road.pts.length - 1; i++) {
            const a = road.pts[i];
            const b = road.pts[i + 1];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len < 12) continue;
            const d = distToSegment(0, 0, a.x, a.y, b.x, b.y);
            // keep clear of junctions at the segment ends
            const t = Math.min(Math.max(d.t, 6 / len), 1 - 6 / len);
            const px = a.x + (b.x - a.x) * t;
            const py = a.y + (b.y - a.y) * t;
            const dist = Math.hypot(px, py);
            if (!best || dist < best.dist) best = { dist, road, a, b, px, py, len };
          }
        }
        if (best) break;
      }
      if (!best) return { x: 0, y: 0, heading: 0, road: null };
      const dx = (best.b.x - best.a.x) / best.len;
      const dy = (best.b.y - best.a.y) / best.len;
      // Norway drives on the right: shift to the right half of a two-way road.
      const shift = best.road.oneway ? 0 : best.road.width / 4;
      return {
        x: best.px + dy * shift,
        y: best.py - dx * shift,
        heading: Math.atan2(dy, dx),
        road: best.road,
      };
    },
  };
}
