import test from 'node:test';
import assert from 'node:assert/strict';
import { planSigns } from '../src/world/build.js';
import { demoNet } from './helpers.js';

test('fartsskilt settes der fartsgrensen endres, på høyre side, vendt mot føreren', () => {
  const net = demoNet();
  const plan = planSigns(net);
  assert.ok(plan.speed.length >= 6);
  // Entering Parkveien (30) from Øvingsveien (50) at (0, 0), heading north:
  const s = plan.speed.find((p) => Math.abs(p.y - 9) < 0.1 && p.x > 0 && p.x < 6);
  assert.ok(s, 'forventet 30-skilt ved innkjøringen til Parkveien');
  assert.equal(s.value, 30);
  assert.ok(s.x > 2.5, 'skiltet skal stå til høyre for kjørebanen');
  assert.ok(s.faceY < -0.99, 'skiltet skal vende mot den som kommer kjørende');
  // No sign at the far end of the one-way street.
  const oneway = net.roads.find((r) => r.name === 'Enveisgata');
  const end = oneway.pts[oneway.pts.length - 1];
  assert.equal(plan.speed.some((p) => Math.hypot(p.x - (end.x - 9), p.y - end.y) < 6 && p.faceX > 0.9), false);
});

test('gangfeltskilt står på begge sider av gangfeltet', () => {
  const plan = planSigns(demoNet());
  assert.equal(plan.crossing.length, 2);
  assert.ok(plan.crossing[0].y * plan.crossing[1].y < 0, 'ett skilt på hver side av veien');
});
