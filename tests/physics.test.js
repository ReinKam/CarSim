import test from 'node:test';
import assert from 'node:assert/strict';
import { CARS, maxSteerRad } from '../src/vehicle/cars.js';
import { createCarState, stepCar, steerAssistLimit } from '../src/vehicle/physics.js';

const car = CARS['tesla-model-y-rwd'];
const DT = 1 / 120;

test('0-100 km/t stemmer med oppgitt tall (5,9 s)', () => {
  const st = createCarState();
  let t = 0;
  while (st.v * 3.6 < 100 && t < 20) {
    stepCar(st, car, { throttle: 1, brake: 0, steer: 0 }, DT);
    t += DT;
  }
  assert.ok(t > car.zeroTo100S - 0.6 && t < car.zeroTo100S + 0.6, `0-100 tok ${t.toFixed(2)} s`);
});

test('bremselengde fra 100 km/t er realistisk', () => {
  const st = createCarState();
  st.v = 100 / 3.6;
  const x0 = st.x;
  let guard = 0;
  while (st.v > 0 && guard++ < 5000) stepCar(st, car, { throttle: 0, brake: 1, steer: 0 }, DT);
  const dist = st.x - x0;
  assert.equal(st.v, 0);
  assert.ok(dist > 33 && dist < 46, `bremselengde ${dist.toFixed(1)} m`);
});

test('bilen ruller ikke bakover etter full stopp', () => {
  const st = createCarState();
  st.v = 5;
  for (let i = 0; i < 2000; i++) stepCar(st, car, { throttle: 0, brake: 0.5, steer: 0 }, DT);
  assert.equal(st.v, 0);
});

test('slipper man gassen, bremser bilen selv (regenerering) og stopper', () => {
  const st = createCarState();
  st.v = 50 / 3.6;
  stepCar(st, car, { throttle: 0, brake: 0, steer: 0 }, DT);
  assert.ok(st.aLong < -1 && st.aLong > -3, `retardasjon ${st.aLong.toFixed(2)} m/s2`);
});

test('snusirkel ved fullt rattutslag stemmer med oppgitt tall (12,1 m)', () => {
  const st = createCarState();
  // creep in a full-lock circle and measure the radius at the rear axle
  let minX = 0;
  let maxX = 0;
  for (let i = 0; i < 120 * 40; i++) {
    stepCar(st, car, { throttle: st.v < 2 ? 0.1 : 0, brake: 0, steer: -1 }, DT);
    minX = Math.min(minX, st.x);
    maxX = Math.max(maxX, st.x);
  }
  const rRear = (maxX - minX) / 2;
  const rOuter = Math.hypot(rRear + car.trackM / 2, car.wheelbaseM);
  assert.ok(Math.abs(rOuter * 2 - car.turningDiameterM) < 0.4, `snusirkel ${(rOuter * 2).toFixed(2)} m`);
});

test('revers kjører bakover og har lav toppfart', () => {
  const st = createCarState();
  st.gear = 'R';
  for (let i = 0; i < 120 * 20; i++) stepCar(st, car, { throttle: 1, brake: 0, steer: 0 }, DT);
  assert.ok(st.v < 0);
  assert.ok(Math.abs(st.v * 3.6) <= car.reverseTopKmh + 1);
});

test('sidekraften begrenses av veigrepet', () => {
  const st = createCarState();
  st.v = 25;
  for (let i = 0; i < 60; i++) stepCar(st, car, { throttle: 0.3, brake: 0, steer: 1 }, DT);
  assert.ok(Math.abs(st.aLat) <= car.tireMu * 9.81 + 0.01);
});

test('tastaturhjelp gir mindre rattutslag i høy fart', () => {
  assert.equal(steerAssistLimit(car, 0), 1);
  const at30 = steerAssistLimit(car, 30 / 3.6);
  const at80 = steerAssistLimit(car, 80 / 3.6);
  assert.ok(at30 < 1 && at80 < at30);
  // lateral acceleration at the limit stays comfortable
  const v = 50 / 3.6;
  const aLat = (v * v * Math.tan(steerAssistLimit(car, v) * maxSteerRad(car))) / car.wheelbaseM;
  assert.ok(aLat < 4);
});
