// Turns the road network into a 3D scene (Three.js).
// World metres (x east, y north) map to Three.js as X = x, Z = -y, Y = up.
// Everything is merged into a handful of meshes so that integrated graphics
// (e.g. Surface Pro) can draw it fast.

import * as THREE from 'three';
import { makeRng } from '../geo.js';
import { speedSignTexture, crossingSignTexture, windowTexture } from './textures.js';

// Heights of the ground layers. polygonOffset keeps them from flickering.
const LAYER = { sidewalk: 0.02, path: 0.03, asphalt: 0.05, marking: 0.08 };

const COLOR = {
  grass: '#6c8f55',
  sidewalk: '#a7a8a3',
  path: '#b9b3a4',
  asphalt: '#3f4245',
  white: '#f2f2ee',
  yellow: '#e3b21a',
  sky: '#b9d7f1',
  haze: '#cfe1f0',
};
const WALLS = ['#d9cdb8', '#c9b79c', '#b8a48a', '#cfcfc8', '#a9b0b5', '#b0654c', '#e2dccf', '#9c8f80'];
const ROOFS = ['#5a5a5e', '#6b5b53', '#44474d'];

/** Collects flat, ground-hugging triangles. */
class FlatBuilder {
  constructor() {
    this.pos = [];
    this.idx = [];
  }
  quad(ax, ay, bx, by, cx, cy, dx, dy, h) {
    const i = this.pos.length / 3;
    this.pos.push(ax, h, -ay, bx, h, -by, cx, h, -cy, dx, h, -dy);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  disc(x, y, r, h, n = 14) {
    const i = this.pos.length / 3;
    this.pos.push(x, h, -y);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      this.pos.push(x + Math.cos(a) * r, h, -(y + Math.sin(a) * r));
    }
    for (let k = 0; k < n; k++) this.idx.push(i, i + 1 + k, i + 1 + ((k + 1) % n));
  }
  /** A strip of constant width along a polyline, with mitred corners. */
  ribbon(pts, halfWidth, h) {
    const n = pts.length;
    if (n < 2) return;
    const closed = pts[0].id != null && pts[0].id === pts[n - 1].id;
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? pts[i - 1] : closed ? pts[n - 2] : null;
      const next = i < n - 1 ? pts[i + 1] : closed ? pts[1] : null;
      let tx = 0;
      let ty = 0;
      let nIn = null;
      if (prev) {
        const l = Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) || 1;
        const dx = (pts[i].x - prev.x) / l;
        const dy = (pts[i].y - prev.y) / l;
        tx += dx;
        ty += dy;
        nIn = { x: -dy, y: dx };
      }
      if (next) {
        const l = Math.hypot(next.x - pts[i].x, next.y - pts[i].y) || 1;
        tx += (next.x - pts[i].x) / l;
        ty += (next.y - pts[i].y) / l;
      }
      const tl = Math.hypot(tx, ty);
      let nx;
      let ny;
      let scale = 1;
      if (tl < 1e-6) {
        // hairpin: fall back to the incoming normal
        nx = nIn ? nIn.x : 0;
        ny = nIn ? nIn.y : 1;
      } else {
        nx = -ty / tl;
        ny = tx / tl;
        if (nIn && next) scale = Math.min(1 / Math.max(nx * nIn.x + ny * nIn.y, 0.5), 2);
      }
      left.push({ x: pts[i].x + nx * halfWidth * scale, y: pts[i].y + ny * halfWidth * scale });
      right.push({ x: pts[i].x - nx * halfWidth * scale, y: pts[i].y - ny * halfWidth * scale });
    }
    for (let i = 0; i < n - 1; i++) {
      this.quad(left[i].x, left[i].y, right[i].x, right[i].y, right[i + 1].x, right[i + 1].y, left[i + 1].x, left[i + 1].y, h);
    }
  }
  mesh(color, order) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    const normals = new Float32Array(this.pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(this.idx);
    const mat = new THREE.MeshLambertMaterial({
      color,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -order,
      polygonOffsetUnits: -order * 2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    return mesh;
  }
}

/** Walks along a road and reports position and direction every `step` metres. */
function walkRoad(road, step, fn) {
  let seg = 0;
  for (let u = step / 2; u < road.length; u += step) {
    while (seg < road.pts.length - 2 && road.cum[seg + 1] < u) seg++;
    const a = road.pts[seg];
    const b = road.pts[seg + 1];
    const len = road.cum[seg + 1] - road.cum[seg] || 1;
    const t = (u - road.cum[seg]) / len;
    const dx = (b.x - a.x) / len;
    const dy = (b.y - a.y) / len;
    fn(u, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, dx, dy);
  }
}

function hashColor(list, id) {
  return list[Math.abs(Math.floor(id * 2654435761) % list.length)];
}

export function buildWorld(net, area) {
  const group = new THREE.Group();
  const stats = { roadsKm: 0, buildings: net.buildings.length, signs: 0, trees: 0 };

  // ---------- Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshLambertMaterial({ color: COLOR.grass }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // ---------- Roads, pavements, paths
  const sidewalk = new FlatBuilder();
  const asphalt = new FlatBuilder();
  const paths = new FlatBuilder();
  const white = new FlatBuilder();
  const yellow = new FlatBuilder();

  for (const p of net.paths) paths.ribbon(p.pts, p.width / 2, LAYER.path);

  const nearJunction = (x, y) => {
    const j = net.nearestJunction(x, y);
    return j && j.dist < j.junction.radius + 2.5;
  };

  for (const road of net.roads) {
    stats.roadsKm += road.length / 1000;
    const hw = road.width / 2;
    asphalt.ribbon(road.pts, hw, LAYER.asphalt);
    if (road.sidewalk) sidewalk.ribbon(road.pts, hw + 2, LAYER.sidewalk);
    // Round off the ends so that roads join cleanly in junctions.
    const ends = [road.pts[0], road.pts[road.pts.length - 1]];
    for (const p of ends) {
      asphalt.disc(p.x, p.y, hw, LAYER.asphalt);
      if (road.sidewalk) sidewalk.disc(p.x, p.y, hw + 2, LAYER.sidewalk);
    }

    if (road.centerLine) {
      // Yellow dashed centre line (3 m line, 9 m gap) and white edge lines, as on Norwegian roads.
      walkRoad(road, 1, (u, x, y, dx, dy) => {
        if (nearJunction(x, y)) return;
        const nx = -dy;
        const ny = dx;
        if (u % 12 < 3) {
          const w = 0.06;
          yellow.quad(
            x - dx * 0.5 + nx * w, y - dy * 0.5 + ny * w,
            x - dx * 0.5 - nx * w, y - dy * 0.5 - ny * w,
            x + dx * 0.5 - nx * w, y + dy * 0.5 - ny * w,
            x + dx * 0.5 + nx * w, y + dy * 0.5 + ny * w,
            LAYER.marking,
          );
        }
        for (const side of [-1, 1]) {
          const o = side * (hw - 0.25);
          const w = 0.05;
          white.quad(
            x - dx * 0.5 + nx * (o + w), y - dy * 0.5 + ny * (o + w),
            x - dx * 0.5 + nx * (o - w), y - dy * 0.5 + ny * (o - w),
            x + dx * 0.5 + nx * (o - w), y + dy * 0.5 + ny * (o - w),
            x + dx * 0.5 + nx * (o + w), y + dy * 0.5 + ny * (o + w),
            LAYER.marking,
          );
        }
      });
    }
  }

  // Zebra crossings
  for (const c of net.crossings) {
    const hw = c.road.width / 2;
    const nx = -c.dirY;
    const ny = c.dirX;
    for (let k = -hw + 0.45; k <= hw - 0.45; k += 1) {
      const x = c.x + nx * k;
      const y = c.y + ny * k;
      white.quad(
        x - c.dirX * 1.5 + nx * 0.25, y - c.dirY * 1.5 + ny * 0.25,
        x - c.dirX * 1.5 - nx * 0.25, y - c.dirY * 1.5 - ny * 0.25,
        x + c.dirX * 1.5 - nx * 0.25, y + c.dirY * 1.5 - ny * 0.25,
        x + c.dirX * 1.5 + nx * 0.25, y + c.dirY * 1.5 + ny * 0.25,
        LAYER.marking,
      );
    }
  }

  group.add(sidewalk.mesh(COLOR.sidewalk, 1));
  group.add(paths.mesh(COLOR.path, 2));
  group.add(asphalt.mesh(COLOR.asphalt, 3));
  group.add(white.mesh(COLOR.white, 4));
  group.add(yellow.mesh(COLOR.yellow, 4));

  // ---------- Buildings
  group.add(...buildBuildings(net));

  // ---------- Signs
  const signs = buildSigns(net);
  stats.signs = signs.count;
  group.add(signs.group);

  // ---------- Trees
  const trees = buildTrees(net, area);
  stats.trees = trees.count;
  group.add(trees.group);

  // ---------- Light and sky
  const lights = new THREE.Group();
  lights.add(new THREE.HemisphereLight('#eaf3ff', '#6f7a5c', 1.9));
  const sun = new THREE.DirectionalLight('#fff3dd', 2.2);
  sun.position.set(-0.45, 1, 0.35);
  lights.add(sun);
  group.add(lights);

  return {
    group,
    stats,
    background: new THREE.Color(COLOR.sky),
    fog: new THREE.Fog(COLOR.haze, 150, 1300),
  };
}

function buildBuildings(net) {
  const wallPos = [];
  const wallUv = [];
  const wallCol = [];
  const roofPos = [];
  const roofCol = [];
  const c = new THREE.Color();

  for (const b of net.buildings) {
    const h = b.height;
    const windows = h >= 5;
    c.set(hashColor(WALLS, b.id));
    const vRep = windows ? Math.max(1, Math.round(h / 3.1)) : 0.15;
    const n = b.pts.length;
    for (let i = 0; i < n; i++) {
      const p = b.pts[i];
      const q = b.pts[(i + 1) % n];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 0.05) continue;
      const uRep = windows ? Math.max(1, Math.round(len / 3.2)) : 0.15;
      // two triangles: p0, q0, q1 and p0, q1, p1
      wallPos.push(p.x, 0, -p.y, q.x, 0, -q.y, q.x, h, -q.y, p.x, 0, -p.y, q.x, h, -q.y, p.x, h, -p.y);
      wallUv.push(0, 0, uRep, 0, uRep, vRep, 0, 0, uRep, vRep, 0, vRep);
      for (let k = 0; k < 6; k++) wallCol.push(c.r, c.g, c.b);
    }
    // Roof
    const contour = b.pts.map((p) => new THREE.Vector2(p.x, p.y));
    let faces = [];
    try {
      faces = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch {
      faces = [];
    }
    c.set(hashColor(ROOFS, b.id));
    for (const f of faces) {
      for (const vi of f) {
        roofPos.push(contour[vi].x, h, -contour[vi].y);
        roofCol.push(c.r, c.g, c.b);
      }
    }
  }

  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wallUv, 2));
  wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(wallCol, 3));
  wallGeo.computeVertexNormals();
  const walls = new THREE.Mesh(
    wallGeo,
    new THREE.MeshLambertMaterial({ map: windowTexture(), vertexColors: true, side: THREE.DoubleSide }),
  );
  walls.frustumCulled = false;

  const roofGeo = new THREE.BufferGeometry();
  roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3));
  roofGeo.setAttribute('color', new THREE.Float32BufferAttribute(roofCol, 3));
  const roofNormals = new Float32Array(roofPos.length);
  for (let i = 1; i < roofNormals.length; i += 3) roofNormals[i] = 1;
  roofGeo.setAttribute('normal', new THREE.BufferAttribute(roofNormals, 3));
  const roofs = new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  roofs.frustumCulled = false;
  return [walls, roofs];
}

/** Where speed-limit and crossing signs should stand. Exported for the automated tests. */
export function planSigns(net) {
  const speed = [];
  for (const road of net.roads) {
    if (road.length < 18 || road.roundabout) continue;
    const last = road.pts.length - 1;
    for (let i = 0; i <= last; i++) {
      // A sign is needed where this road meets a road with a different limit.
      const others = (net.nodeRoads.get(road.pts[i].id) || []).filter((o) => o.road !== road);
      if (!others.some((o) => o.road.maxspeed !== road.maxspeed)) continue;
      // One sign for each direction you can drive away from that junction along this road.
      for (const dirSign of [1, -1]) {
        if (dirSign === -1 && road.oneway) continue; // nobody drives against a one-way street
        const u = road.cum[i] + dirSign * 9; // 9 m past the junction
        if (u < 3 || u > road.length - 3) continue;
        let seg = 0;
        while (seg < last - 1 && road.cum[seg + 1] < u) seg++;
        const a = road.pts[seg];
        const b = road.pts[seg + 1];
        const len = road.cum[seg + 1] - road.cum[seg] || 1;
        const t = (u - road.cum[seg]) / len;
        const dx = ((b.x - a.x) / len) * dirSign;
        const dy = ((b.y - a.y) / len) * dirSign;
        const off = road.width / 2 + 0.9; // right-hand side, facing the driver
        speed.push({
          value: road.maxspeed,
          x: a.x + (b.x - a.x) * t + dy * off,
          y: a.y + (b.y - a.y) * t - dx * off,
          faceX: -dx,
          faceY: -dy,
        });
      }
    }
  }
  const crossing = [];
  for (const c of net.crossings) {
    const off = c.road.width / 2 + 0.9;
    for (const dirSign of c.road.oneway ? [1] : [1, -1]) {
      const dx = c.dirX * dirSign;
      const dy = c.dirY * dirSign;
      crossing.push({ x: c.x - dx * 2 + dy * off, y: c.y - dy * 2 - dx * off, faceX: -dx, faceY: -dy });
    }
  }
  return { speed, crossing };
}

function buildSigns(net) {
  const plan = planSigns(net);
  const group = new THREE.Group();
  const all = [...plan.speed, ...plan.crossing];
  if (!all.length) return { group, count: 0 };

  const dummy = new THREE.Object3D();
  const place = (mesh, i, s, y) => {
    dummy.position.set(s.x, y, -s.y);
    dummy.rotation.set(0, Math.atan2(s.faceX, -s.faceY), 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };

  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.035, 0.035, 2.5, 6),
    new THREE.MeshLambertMaterial({ color: '#8a8d90' }),
    all.length,
  );
  all.forEach((s, i) => place(poles, i, s, 1.25));
  group.add(poles);

  // Speed limit signs (sign 362), one instanced mesh per value
  const byValue = new Map();
  for (const s of plan.speed) {
    if (!byValue.has(s.value)) byValue.set(s.value, []);
    byValue.get(s.value).push(s);
  }
  const disc = new THREE.CircleGeometry(0.35, 24);
  for (const [value, list] of byValue) {
    const mesh = new THREE.InstancedMesh(
      disc,
      new THREE.MeshBasicMaterial({ map: speedSignTexture(value), side: THREE.FrontSide }),
      list.length,
    );
    list.forEach((s, i) => place(mesh, i, s, 2.35));
    group.add(mesh);
  }
  // Pedestrian crossing signs (sign 516)
  if (plan.crossing.length) {
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.62, 0.62),
      new THREE.MeshBasicMaterial({ map: crossingSignTexture() }),
      plan.crossing.length,
    );
    plan.crossing.forEach((s, i) => place(mesh, i, s, 2.35));
    group.add(mesh);
  }
  // Grey backs
  const backGeo = new THREE.CircleGeometry(0.36, 16);
  backGeo.rotateY(Math.PI);
  const backs = new THREE.InstancedMesh(backGeo, new THREE.MeshLambertMaterial({ color: '#9a9da0' }), all.length);
  all.forEach((s, i) => place(backs, i, s, 2.35));
  group.add(backs);

  for (const m of group.children) m.frustumCulled = false;
  return { group, count: all.length };
}

function buildTrees(net, area) {
  const rng = makeRng(20261113);
  const spots = net.trees.map((t) => ({ x: t.x, y: t.y }));
  const half = (area.halfSizeM || 600) + 150;
  for (let i = 0; i < 1400 && spots.length < 520; i++) {
    const x = (rng() * 2 - 1) * half;
    const y = (rng() * 2 - 1) * half;
    const loc = net.locate(x, y, 0);
    if (loc && loc.edgeDist < 5) continue;
    if (net.buildingAt(x, y)) continue;
    spots.push({ x, y });
  }
  const group = new THREE.Group();
  if (!spots.length) return { group, count: 0 };

  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 3, 6);
  trunkGeo.translate(0, 1.5, 0);
  const coniferGeo = new THREE.ConeGeometry(2.1, 7.5, 7);
  coniferGeo.translate(0, 6, 0);
  const leafGeo = new THREE.IcosahedronGeometry(2.7, 1);
  leafGeo.translate(0, 5, 0);

  const conifers = spots.filter((_, i) => i % 3 !== 0);
  const leafy = spots.filter((_, i) => i % 3 === 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#6b5138' }), spots.length);
  const coniferMesh = new THREE.InstancedMesh(coniferGeo, new THREE.MeshLambertMaterial({ color: '#2f5d3a' }), Math.max(conifers.length, 1));
  const leafMesh = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: '#5d8a3c', flatShading: true }), Math.max(leafy.length, 1));
  coniferMesh.count = conifers.length;
  leafMesh.count = leafy.length;

  const dummy = new THREE.Object3D();
  const put = (mesh, i, s, scale) => {
    dummy.position.set(s.x, 0, -s.y);
    dummy.rotation.set(0, rng() * Math.PI, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };
  spots.forEach((s, i) => put(trunks, i, s, 1));
  conifers.forEach((s, i) => put(coniferMesh, i, s, 0.8 + rng() * 0.7));
  leafy.forEach((s, i) => put(leafMesh, i, s, 0.7 + rng() * 0.6));
  for (const m of [trunks, coniferMesh, leafMesh]) {
    m.frustumCulled = false;
    group.add(m);
  }
  return { group, count: spots.length };
}
