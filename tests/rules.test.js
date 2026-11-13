import test from 'node:test';
import assert from 'node:assert/strict';
import { newSim, drive, types } from './helpers.js';
import { buildReport } from '../src/rules/report.js';
import { RuleEngine, describeEvent } from '../src/rules/engine.js';

test('pen kjøring gir ingen anmerkninger', () => {
  const sim = newSim(-280, -1.6, 0);
  drive(sim, [[-120, -1.6], [-20, -1.6]], 45);
  assert.deepEqual(types(sim), []);
});

test('for høy fart blir registrert med riktig alvorlighet', () => {
  const sim = newSim(-280, -1.6, 0);
  drive(sim, [[150, -1.6]], 58);
  const e = sim.engine.events.find((ev) => ev.type === 'fart');
  assert.ok(e, 'forventet fartsanmerkning');
  assert.equal(e.limit, 50);
  assert.equal(e.severity, 'middels');
  assert.ok(e.maxKmh > 55 && e.maxKmh < 62);
  assert.match(describeEvent(e), /50-sone \(Øvingsveien\)/);

  const fast = newSim(-280, -1.6, 0);
  drive(fast, [[150, -1.6]], 70);
  assert.equal(fast.engine.events.find((ev) => ev.type === 'fart').severity, 'alvorlig');
});

test('3 km/t over grensen tolereres', () => {
  const sim = newSim(-280, -1.6, 0);
  drive(sim, [[150, -1.6]], 51);
  assert.equal(types(sim).includes('fart'), false);
});

test('kjøring i motgående felt blir registrert', () => {
  const sim = newSim(-180, 1.7, 0); // left lane, heading east
  drive(sim, [[-125, 1.7], [-30, 1.7]], 40);
  assert.ok(types(sim).includes('motgaende'));
});

test('kjøring utenfor veien blir registrert', () => {
  const sim = newSim(-280, -1.6, 0);
  drive(sim, [[-260, -9], [-230, -10]], 20);
  assert.ok(types(sim).includes('utenfor_vei'));
});

test('kjøring mot enveiskjøring blir registrert', () => {
  const sim = newSim(-20, 200, 180); // Enveisgata goes west -> east; we head west
  drive(sim, [[-100, 200]], 25);
  assert.ok(types(sim).includes('feil_retning'));
});

test('sving uten blinklys gir anmerkning, med blinklys gjør den ikke det', () => {
  // East on Øvingsveien, then left (north) into Parkveien at (0, 0).
  const route = [[-10, -1.6], [-1.4, 12], [-1.4, 45]];
  const without = newSim(-80, -1.6, 0);
  drive(without, route, 30);
  const e = without.engine.events.find((ev) => ev.type === 'blinklys');
  assert.ok(e, 'forventet blinklysanmerkning');
  assert.equal(e.direction, 'venstre');
  assert.match(e.where, /Parkveien/);

  const withSignal = newSim(-80, -1.6, 0);
  drive(withSignal, route, 30, { blinker: (sim) => (sim.centre.x > -50 && sim.centre.y < 10 ? 'left' : undefined) });
  assert.equal(types(withSignal).includes('blinklys'), false);
  assert.equal(withSignal.engine.stats.turnsSignalled, 1);
});

test('feil blinklys gir egen tekst', () => {
  const sim = newSim(-80, -1.6, 0);
  drive(sim, [[-10, -1.6], [-1.4, 12], [-1.4, 45]], 30, {
    blinker: (s) => (s.centre.x > -50 && s.centre.y < 10 ? 'right' : undefined),
  });
  const e = sim.engine.events.find((ev) => ev.type === 'blinklys');
  assert.equal(e.wrongSide, true);
  assert.match(describeEvent(e), /feil vei/);
});

test('rett fram gjennom kryss krever ikke blinklys', () => {
  const sim = newSim(-80, -1.6, 0);
  drive(sim, [[60, -1.6]], 40);
  assert.equal(types(sim).includes('blinklys'), false);
  assert.equal(sim.engine.stats.turns, 0);
});

test('ut av rundkjøring uten høyre blinklys gir anmerkning', () => {
  // Enter from the west, circulate counter-clockwise, leave north on Nordveien.
  const route = [[292, -1.6], [305, -9], [318, -11.5], [326, -3], [322, 9], [315.6, 20], [315.6, 60]];
  const without = newSim(240, -1.6, 0);
  drive(without, route, 22);
  const e = without.engine.events.find((ev) => ev.type === 'blinklys');
  assert.ok(e, 'forventet anmerkning ut av rundkjøring');
  assert.equal(e.roundabout, true);
  assert.equal(types(without).includes('feil_retning'), false);

  const withSignal = newSim(240, -1.6, 0);
  drive(withSignal, route, 22, { blinker: (s) => (s.centre.x > 318 && s.centre.y > -6 ? 'right' : undefined) });
  assert.equal(types(withSignal).includes('blinklys'), false);
});

test('kollisjon med bygning stopper bilen og gir alvorlig anmerkning', () => {
  const sim = newSim(-60, 5, 90); // heading north towards the shop at y = 15
  for (let i = 0; i < 600; i++) sim.step(1 / 60, { throttle: 0.5, brake: 0, steer: 0 });
  assert.ok(types(sim).includes('kollisjon'));
  assert.equal(sim.state.v, 0);
  assert.equal(sim.roadnet.buildingAt(sim.centre.x, sim.centre.y), null);
});

test('blinklyset slår seg av etter svingen', () => {
  const sim = newSim(-80, -1.6, 0);
  sim.toggleBlinker('left');
  drive(sim, [[-10, -1.6], [-1.4, 12], [-1.4, 60]], 25);
  assert.equal(sim.blinker, null);
});

test('rapport: alvorlig feil gir ikke bestått, pen kjøring gir bestått', () => {
  const rules = { ...new RuleEngine().rules, minSessionS: 5, minSessionM: 50 };
  const good = newSim(-280, -1.6, 0);
  drive(good, [[150, -1.6]], 45);
  const r1 = buildReport(good.engine, rules);
  assert.equal(r1.verdict, 'bestatt');
  assert.equal(r1.groups.length, 0);
  assert.ok(r1.stats.distanceM > 400);

  const bad = newSim(-280, -1.6, 0);
  drive(bad, [[150, -1.6]], 70);
  const r2 = buildReport(bad.engine, rules);
  assert.equal(r2.verdict, 'ikke_bestatt');
  assert.match(r2.reasons[0], /Fart over fartsgrensen/);
  assert.ok(r2.advice.length >= 1);
  assert.ok(r2.stats.speedingShare > 0.5);
});

test('rapport: for kort økt gir ingen dom', () => {
  const sim = newSim(-280, -1.6, 0);
  drive(sim, [[-250, -1.6]], 30);
  assert.equal(buildReport(sim.engine).verdict, 'for_kort');
});

test('rapport: tre middels feil gir ikke bestått', () => {
  const engine = new RuleEngine();
  engine.stats.duration = 600;
  engine.stats.distance = 3000;
  engine.stats.movingTime = 500;
  for (let i = 0; i < 3; i++) {
    engine.events.push({ type: 'blinklys', severity: 'middels', t: i, where: 'A / B', direction: 'venstre' });
  }
  const r = buildReport(engine);
  assert.equal(r.verdict, 'ikke_bestatt');
  assert.equal(r.groups[0].items.length, 3);
});
