// Test helpers: a tiny "robot driver" that follows waypoints on the practice area.

import { buildRoadNet } from '../src/map/roadnet.js';
import { makeDemoOsm } from '../src/map/demo-area.js';
import { Simulation } from '../src/sim.js';
import { CARS } from '../src/vehicle/cars.js';
import { placeCar } from '../src/vehicle/physics.js';
import { wrapAngle, clamp } from '../src/geo.js';

export const AREA = { id: 'test', name: 'Test', lat: 59.941, lon: 10.8972, halfSizeM: 600 };
export const CAR = CARS['tesla-model-y-rwd'];

export function demoNet() {
  return buildRoadNet(makeDemoOsm(AREA), AREA);
}

export function newSim(x, y, headingDeg) {
  const sim = new Simulation(demoNet(), CAR);
  placeCar(sim.state, CAR, x, y, (headingDeg * Math.PI) / 180);
  sim._locate();
  return sim;
}

/**
 * Drive through the waypoints at roughly targetKmh.
 * opts.blinker: (sim) => 'left' | 'right' | null, called every step.
 */
export function drive(sim, waypoints, targetKmh, opts = {}) {
  const dt = 1 / 60;
  const events = [];
  let guard = 0;
  for (const [wx, wy] of waypoints) {
    for (;;) {
      if (++guard > 60 * 600) throw new Error('robot driver got lost');
      const c = sim.centre;
      const dist = Math.hypot(wx - c.x, wy - c.y);
      if (dist < 4) break;
      const want = Math.atan2(wy - c.y, wx - c.x);
      const err = wrapAngle(want - sim.state.heading); // + = need to turn left
      const steer = clamp(-err * 2.2, -1, 1);
      const kmh = sim.state.v * 3.6;
      // slow down for sharp turns
      const target = Math.abs(err) > 0.5 ? Math.min(targetKmh, 15) : targetKmh;
      const throttle = kmh < target ? clamp((target - kmh) * 0.08, 0, 0.6) : 0;
      const brake = kmh > target + 3 ? 0.3 : 0;
      if (opts.blinker) {
        const b = opts.blinker(sim);
        if (b !== undefined && b !== sim.blinker) {
          sim.blinker = b;
          sim._blinkArmed = false;
        }
      }
      events.push(...sim.step(dt, { throttle, brake, steer }));
    }
  }
  return events;
}

export function types(sim) {
  return sim.engine.events.map((e) => e.type);
}
