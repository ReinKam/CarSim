import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadNet } from '../src/map/roadnet.js';
import { overpassQuery } from '../src/map/osm.js';
import { demoNet, AREA } from './helpers.js';

test('øvingsbanen gir veier, kryss og bygninger', () => {
  const net = demoNet();
  assert.ok(net.roads.length >= 9);
  assert.ok(net.buildings.length >= 10);
  assert.ok(net.junctions.length >= 8);
  assert.equal(net.crossings.length, 1);
  const main = net.roads.find((r) => r.name === 'Øvingsveien');
  assert.equal(main.maxspeed, 50);
  assert.equal(main.centerLine, true);
  assert.equal(main.oneway, false);
  const oneway = net.roads.find((r) => r.name === 'Enveisgata');
  assert.equal(oneway.oneway, true);
  assert.equal(oneway.maxspeed, 30);
  const ring = net.roads.find((r) => r.roundabout);
  assert.equal(ring.oneway, true);
});

test('locate finner riktig vei, side og retning', () => {
  const net = demoNet();
  // right-hand lane of Øvingsveien, heading east
  const east = net.locate(-250, -1.6, 0);
  assert.equal(east.road.name, 'Øvingsveien');
  assert.equal(east.along, 1);
  assert.ok(Math.abs(east.lateral + 1.6) < 0.01);
  assert.ok(east.edgeDist < 0);
  // heading west in the other lane
  const west = net.locate(-250, 1.6, Math.PI);
  assert.equal(west.along, -1);
  assert.ok(west.lateral > 0);
  // far outside the road
  const off = net.locate(-250, 12, 0);
  assert.ok(off.edgeDist > 5);
  assert.equal(net.locate(5000, 5000, 0), null);
});

test('kryss får navn etter veiene som møtes', () => {
  const net = demoNet();
  const j = net.nearestJunction(-199, 1);
  assert.ok(j.dist < 2);
  assert.match(j.junction.name, /Øvingsveien/);
  assert.match(j.junction.name, /Skolegata/);
});

test('bygninger kan treffes', () => {
  const net = demoNet();
  assert.ok(net.buildingAt(-60, 30));
  assert.equal(net.buildingAt(-60, 0), null);
});

test('startpunktet ligger på en vei, i høyre felt', () => {
  const net = demoNet();
  const s = net.findSpawn();
  const loc = net.locate(s.x, s.y, s.heading);
  assert.ok(loc.edgeDist < 0);
  assert.equal(loc.along, 1);
  assert.ok(loc.lateral < 0, 'skal stå til høyre for midten');
});

test('tåler rotete kartdata', () => {
  const osm = {
    elements: [
      { type: 'node', id: 1, lat: 59.941, lon: 10.897 },
      { type: 'node', id: 2, lat: 59.942, lon: 10.897 },
      { type: 'node', id: 3, lat: 59.942, lon: 10.899, tags: { highway: 'crossing' } },
      { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential', maxspeed: 'signals', lanes: 'x' } },
      { type: 'way', id: 11, nodes: [1, 99], tags: { highway: 'residential' } }, // missing node
      { type: 'way', id: 12, nodes: [1, 2], tags: { highway: 'motorway' } },
      { type: 'way', id: 13, nodes: [1, 2], tags: { highway: 'tertiary', tunnel: 'yes' } },
      { type: 'way', id: 14, nodes: [2, 3], tags: { highway: 'service', oneway: '-1', maxspeed: '30 mph' } },
      { type: 'way', id: 15, nodes: [1, 2, 3], tags: { building: 'yes' } }, // not closed
      { type: 'way', id: 16, nodes: [1, 2], tags: { highway: 'construction' } },
      { type: 'relation', id: 20, members: [] },
      { type: 'way', id: 17 },
    ],
  };
  const net = buildRoadNet(osm, AREA);
  assert.equal(net.roads.length, 2);
  assert.equal(net.roads[0].maxspeed, 50); // unreadable tag -> general limit
  assert.equal(net.roads[1].maxspeed, 48);
  assert.equal(net.roads[1].oneway, true);
  assert.equal(net.roads[1].pts[0].id, 3); // reversed
  assert.equal(net.buildings.length, 0);
  assert.equal(net.skipped.motorway, 1);
  assert.equal(net.skipped.tunnel, 1);
});

test('kartspørringen dekker området rundt Furuset', () => {
  const q = overpassQuery({ lat: 59.941, lon: 10.8972, halfSizeM: 600 });
  assert.match(q, /way\["highway"\]\(59\.9356\d+,10\.8864\d+,59\.9463\d+,10\.9079\d+\)/);
});

test('veier som er stengt for vanlig biltrafikk blir merket og brukes ikke som startpunkt', () => {
  const osm = {
    elements: [
      { type: 'node', id: 1, lat: 59.941, lon: 10.8972 },
      { type: 'node', id: 2, lat: 59.941, lon: 10.899 },
      { type: 'node', id: 3, lat: 59.9425, lon: 10.8972 },
      { type: 'node', id: 4, lat: 59.9425, lon: 10.899 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential', name: 'Bussgata', motor_vehicle: 'no', bus: 'yes' } },
      { type: 'way', id: 11, nodes: [3, 4], tags: { highway: 'residential', name: 'Vanlig gate' } },
      { type: 'way', id: 12, nodes: [1, 3], tags: { highway: 'service', access: 'private' } },
      { type: 'way', id: 13, nodes: [2, 4], tags: { highway: 'service', access: 'no', motor_vehicle: 'yes' } },
    ],
  };
  const net = buildRoadNet(osm, AREA);
  assert.deepEqual(net.roads.map((r) => r.restricted), [true, false, true, false]);
  assert.equal(net.findSpawn().road.name, 'Vanlig gate');
});
