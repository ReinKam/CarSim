// One driving session: the car, where it is on the map, and the instructor.
// No rendering and no input devices here, so a whole drive can be simulated
// in an automated test.

import { createCarState, placeCar, stepCar, carCentre, carCorners } from './vehicle/physics.js';
import { RuleEngine } from './rules/engine.js';

const RULE_INTERVAL = 1 / 30; // the instructor looks at the drive 30 times per second

export class Simulation {
  constructor(roadnet, car) {
    this.roadnet = roadnet;
    this.car = car;
    this.state = createCarState();
    this.reset();
  }

  reset() {
    const spawn = this.roadnet.findSpawn();
    placeCar(this.state, this.car, spawn.x, spawn.y, spawn.heading);
    this.state.gear = 'D';
    this.state.odometer = 0;
    this.engine = new RuleEngine();
    this.time = 0;
    this.blinker = null; // 'left' | 'right' | null
    this._blinkArmed = false;
    this.loc = null;
    this.junction = null;
    this.offRoad = false;
    this.path = []; // driven route, for the report map
    this._ruleClock = 0;
    this._collided = false;
    this._impactKmh = 0;
    this._aLong = 0;
    this._aLat = 0;
    this._lastPathPoint = null;
    this._locate();
  }

  _locate() {
    const c = carCentre(this.state, this.car);
    this.centre = c;
    this.loc = this.roadnet.locate(c.x, c.y, this.state.heading, this.loc ? this.loc.road : null);
    this.junction = this.roadnet.nearestJunction(c.x, c.y);
    this.offRoad = !this.loc || this.loc.edgeDist > 0.5;
  }

  toggleBlinker(side) {
    this.blinker = this.blinker === side ? null : side;
    this._blinkArmed = false;
  }

  /** Switch between drive and reverse. Only possible when (almost) standing still. */
  toggleReverse() {
    if (Math.abs(this.state.v) > 0.5) return false;
    this.state.gear = this.state.gear === 'R' ? 'D' : 'R';
    return true;
  }

  /** Put the car back on the nearest road, standing still. */
  recover() {
    const c = this.centre;
    const loc = this.roadnet.locate(c.x, c.y, this.state.heading, null);
    if (!loc) {
      const spawn = this.roadnet.findSpawn();
      placeCar(this.state, this.car, spawn.x, spawn.y, spawn.heading);
    } else {
      const road = loc.road;
      const a = road.pts[loc.segIndex];
      const t = loc.s - road.cum[loc.segIndex];
      const dir = road.oneway ? 1 : loc.along;
      const shift = road.oneway ? 0 : road.width / 4;
      const dx = loc.dirX * dir;
      const dy = loc.dirY * dir;
      placeCar(
        this.state,
        this.car,
        a.x + loc.dirX * t + dy * shift,
        a.y + loc.dirY * t - dx * shift,
        Math.atan2(dy, dx),
      );
    }
    this.state.gear = 'D';
    this._locate();
  }

  /**
   * Advance the session by dt seconds.
   * controls: { throttle, brake, steer }
   * Returns the instructor's new remarks (usually an empty array).
   */
  step(dt, controls) {
    const st = this.state;
    const px = st.x;
    const py = st.y;
    const ph = st.heading;
    const speedBefore = st.v;

    stepCar(st, this.car, controls, dt, { offRoad: this.offRoad });

    // Collision with buildings: stop the car where it was.
    for (const corner of carCorners(st, this.car)) {
      if (this.roadnet.buildingAt(corner.x, corner.y)) {
        this._collided = true;
        this._impactKmh = Math.max(this._impactKmh, Math.abs(speedBefore) * 3.6);
        st.x = px;
        st.y = py;
        st.heading = ph;
        st.v = 0;
        st.yawRate = 0;
        break;
      }
    }

    this._locate();
    this.time += dt;

    // Indicator cancels itself when the steering wheel returns after a turn.
    if (this.blinker) {
      const toward = this.blinker === 'left' ? st.steer : -st.steer;
      if (toward > 0.1) this._blinkArmed = true;
      else if (this._blinkArmed && toward < 0.02) {
        this.blinker = null;
        this._blinkArmed = false;
      }
    }

    // Smoothed accelerations, so a single jerky frame is not reported.
    const k = Math.min(1, dt / 0.15);
    this._aLong += (st.aLong - this._aLong) * k;
    this._aLat += (st.aLat - this._aLat) * k;

    const c = this.centre;
    if (!this._lastPathPoint || Math.hypot(c.x - this._lastPathPoint.x, c.y - this._lastPathPoint.y) > 3) {
      this._lastPathPoint = { x: c.x, y: c.y };
      this.path.push(this._lastPathPoint);
    }

    this._ruleClock += dt;
    if (this._ruleClock < RULE_INTERVAL) return [];
    const sample = {
      t: this.time,
      dt: this._ruleClock,
      x: c.x,
      y: c.y,
      heading: st.heading,
      speed: st.v,
      accelLong: this._collided ? 0 : this._aLong,
      accelLat: this._aLat,
      gear: st.gear,
      blinker: this.blinker,
      road: this.loc ? this.loc.road : null,
      lateral: this.loc ? this.loc.lateral : 0,
      along: this.loc ? this.loc.along : 1,
      edgeDist: this.loc ? this.loc.edgeDist : Infinity,
      junctionDist: this.junction ? this.junction.dist : Infinity,
      junctionName: this.junction ? this.junction.junction.name : '',
      collided: this._collided,
      impactKmh: this._impactKmh,
    };
    this._ruleClock = 0;
    this._collided = false;
    this._impactKmh = 0;
    return this.engine.update(sample);
  }
}
