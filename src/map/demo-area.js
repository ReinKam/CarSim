// A small made-up practice area in the same format as OpenStreetMap data.
// Used when real map data cannot be fetched, and by the automated tests.

import { makeProjection } from '../geo.js';

export function makeDemoOsm(area) {
  const proj = makeProjection(area.lat, area.lon);
  const elements = [];
  const byKey = new Map();
  let nextId = 1;

  function node(x, y, tags) {
    const key = `${Math.round(x * 10)},${Math.round(y * 10)}`;
    let id = byKey.get(key);
    if (id) {
      if (tags) Object.assign((elements.find((e) => e.id === id).tags ||= {}), tags);
      return id;
    }
    id = nextId++;
    byKey.set(key, id);
    const ll = proj.toLatLon(x, y);
    const el = { type: 'node', id, lat: ll.lat, lon: ll.lon };
    if (tags) el.tags = tags;
    elements.push(el);
    return id;
  }
  function way(points, tags) {
    elements.push({ type: 'way', id: nextId++, nodes: points.map((p) => (Array.isArray(p) ? node(p[0], p[1]) : p)), tags });
  }
  function building(x, y, w, d, tags = {}) {
    way(
      [
        [x, y],
        [x + w, y],
        [x + w, y + d],
        [x, y + d],
        [x, y],
      ],
      { building: 'yes', ...tags },
    );
  }

  // Roundabout centred at (314, 0), counter-clockwise as in right-hand traffic.
  const R = 14;
  const cx = 314;
  const ring = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * 2 * Math.PI;
    ring.push(node(cx + R * Math.cos(a), R * Math.sin(a)));
  }
  way([...ring, ring[0]], { highway: 'tertiary', junction: 'roundabout', maxspeed: '50' });
  const west = ring[6]; // (300, 0)
  const north = ring[3]; // (314, 14)
  const south = ring[9]; // (314, -14)
  const east = ring[0]; // (328, 0)

  // Main road with a pedestrian crossing.
  way(
    [[-300, 0], [-200, 0], node(-100, 0, { highway: 'crossing' }), [0, 0], [100, 0], [200, 0], west],
    { highway: 'tertiary', name: 'Øvingsveien', maxspeed: '50', lanes: '2' },
  );
  way([east, [430, 0]], { highway: 'tertiary', name: 'Øvingsveien', maxspeed: '50', lanes: '2' });
  way([north, [314, 120], [314, 250]], { highway: 'tertiary', name: 'Nordveien', maxspeed: '50', lanes: '2' });
  way([south, [314, -100], [314, -200]], { highway: 'residential', name: 'Sørveien', maxspeed: '30' });

  // Residential streets.
  way([[-200, -200], [-200, -100], [-200, 0], [-200, 100], [-200, 200]], {
    highway: 'residential',
    name: 'Skolegata',
    maxspeed: '30',
  });
  way([[0, 0], [0, 100], [0, 200], [100, 200], [200, 200], [200, 100], [200, 0]], {
    highway: 'residential',
    name: 'Parkveien',
    maxspeed: '30',
  });
  way([[-200, 200], [-100, 200], [0, 200]], { highway: 'residential', name: 'Enveisgata', maxspeed: '30', oneway: 'yes' });
  way([[-200, -200], [-50, -200], [100, -200], [314, -200]], { highway: 'residential', name: 'Sørgata', maxspeed: '30' });
  way([[100, 0], [100, -60], [150, -60]], { highway: 'service', service: 'parking_aisle' });
  way([[60, 60], [60, 140]], { highway: 'footway' });

  // Buildings.
  building(-180, 20, 60, 30, { 'building:levels': '4', building: 'apartments' });
  building(-180, 70, 60, 30, { 'building:levels': '4', building: 'apartments' });
  building(-90, 15, 60, 40, { building: 'retail', name: 'Øvingssenteret' });
  building(20, 20, 30, 40, { building: 'school' });
  building(120, 30, 50, 25, { 'building:levels': '3' });
  building(120, 110, 50, 60, { 'building:levels': '6', building: 'apartments' });
  building(20, 215, 25, 12, { building: 'house' });
  building(60, 215, 25, 12, { building: 'house' });
  building(110, 215, 25, 12, { building: 'house' });
  building(-170, -90, 40, 60, { 'building:levels': '2' });
  building(-100, -60, 80, 35, { 'building:levels': '5', building: 'apartments' });
  building(160, -110, 60, 40, { building: 'commercial' });
  building(340, 40, 40, 60, { 'building:levels': '4' });
  building(340, -120, 30, 50, { building: 'house' });
  building(215, 60, 30, 80, { 'building:levels': '3' });

  for (const [x, y] of [[-250, 15], [-140, -15], [-40, 14], [70, -14], [230, 14], [290, 30], [330, -40], [-215, 150], [15, 150]]) {
    node(x, y, { natural: 'tree' });
  }

  return { version: 0.6, generator: 'CarSim demo area', elements };
}
