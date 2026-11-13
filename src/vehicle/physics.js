// Vehicle dynamics. Pure functions, no rendering, so they can be unit tested.
//
// Model: longitudinal forces (motor, brakes, regeneration, air drag, rolling
// resistance, traction limit) plus a kinematic bicycle model for steering,
// with lateral acceleration capped by tyre grip (the car understeers when the
// driver asks for more than the tyres can give).
//
// The state position (x, y) is the centre of the REAR axle.

import { clamp } from '../geo.js';
import { maxSteerRad } from './cars.js';

const G = 9.81;
const AIR_DENSITY = 1.2;

export function createCarState(x = 0, y = 0, heading = 0) {
  return { x, y, heading, v: 0, steer: 0, yawRate: 0, gear: 'D', aLong: 0, aLat: 0, odometer: 0 };
}

/** Place the car so that its geometric centre is at (cx, cy). */
export function placeCar(state, car, cx, cy, heading) {
  const back = car.wheelbaseM / 2;
  state.x = cx - Math.cos(heading) * back;
  state.y = cy - Math.sin(heading) * back;
  state.heading = heading;
  state.v = 0;
  state.steer = 0;
  state.yawRate = 0;
  state.aLong = 0;
  state.aLat = 0;
}

export function carCentre(state, car) {
  const f = car.wheelbaseM / 2;
  return { x: state.x + Math.cos(state.heading) * f, y: state.y + Math.sin(state.heading) * f };
}

/** The four corners of the car body, for collision checks. */
export function carCorners(state, car) {
  const c = Math.cos(state.heading);
  const s = Math.sin(state.heading);
  const front = car.wheelbaseM + car.overhangFrontM;
  const rear = -(car.lengthM - car.wheelbaseM - car.overhangFrontM);
  const hw = car.widthM / 2;
  const out = [];
  for (const [lx, ly] of [
    [front, hw],
    [front, -hw],
    [rear, hw],
    [rear, -hw],
  ]) {
    out.push({ x: state.x + c * lx - s * ly, y: state.y + s * lx + c * ly });
  }
  return out;
}

/**
 * Advance the car by dt seconds.
 * controls: throttle 0..1, brake 0..1, steer -1..1 (+1 = full right).
 * env.offRoad: true when the car is off the paved surface.
 */
export function stepCar(state, car, controls, dt, env = {}) {
  const mass = car.massKg + (car.driverKg ?? 0);
  const throttle = clamp(controls.throttle ?? 0, 0, 1);
  const brake = clamp(controls.brake ?? 0, 0, 1);

  // --- Steering: front wheels follow the steering wheel with a small lag.
  const steerMax = maxSteerRad(car);
  const steerTarget = -clamp(controls.steer ?? 0, -1, 1) * steerMax; // + = left
  const maxDelta = 3.0 * dt;
  state.steer += clamp(steerTarget - state.steer, -maxDelta, maxDelta);

  // --- Longitudinal forces.
  const dir = state.gear === 'D' ? 1 : state.gear === 'R' ? -1 : 0;
  const speed = Math.abs(state.v);
  const tractionMax = car.tireMu * mass * G * car.drivenAxleLoad;
  let drive = 0;
  if (dir !== 0) {
    const motorMax = Math.min(
      (car.torqueNm * car.gearRatio) / car.wheelRadiusM,
      (car.powerKw * 1000) / Math.max(speed, 0.5),
    );
    const cap = (dir > 0 ? car.topSpeedKmh : car.reverseTopKmh) / 3.6;
    const moving = state.v * dir; // speed in the selected direction
    if (moving < cap) drive = Math.min(motorMax, tractionMax) * throttle * dir;
    // Regenerative braking when the accelerator is (almost) released.
    if (car.regenDecel && throttle < 0.1 && moving > 0.3) {
      const fade = clamp((moving - 0.3) / 2.5, 0, 1); // fades out at walking pace
      drive -= dir * car.regenDecel * mass * fade * (1 - throttle / 0.1);
    }
  }

  const drag = 0.5 * AIR_DENSITY * car.cd * car.frontalAreaM2 * state.v * state.v;
  const roll = (env.offRoad ? 0.12 : car.crr) * mass * G;
  const brakeForce = Math.min(brake * car.brakeDecelMax, car.tireMu * G * 1.1) * mass;
  const resist = drag + roll + brakeForce;

  const sign = state.v > 0 ? 1 : state.v < 0 ? -1 : 0;
  let accel;
  if (sign === 0) {
    // Standing still: brakes and rolling resistance hold the car until the motor wins.
    const net = Math.abs(drive) - (roll + brakeForce);
    accel = net > 0 ? (Math.sign(drive) * net) / mass : 0;
  } else {
    accel = (drive - sign * resist) / mass;
  }

  let v = state.v + accel * dt;
  // Resistive forces can stop the car but never push it the other way.
  if (sign !== 0 && Math.sign(v) !== sign && Math.sign(drive) !== -sign) v = 0;
  if (sign !== 0 && Math.sign(v) !== sign && Math.abs(drive) <= roll + brakeForce) v = 0;

  // --- Lateral: kinematic bicycle with a grip limit.
  let yaw = (v / car.wheelbaseM) * Math.tan(state.steer);
  const latMax = car.tireMu * G;
  if (Math.abs(v * yaw) > latMax) yaw = (Math.sign(yaw) * latMax) / Math.abs(v);

  state.aLong = (v - state.v) / dt;
  state.aLat = v * yaw;
  state.v = v;
  state.yawRate = yaw;
  state.heading += yaw * dt;
  if (state.heading > Math.PI) state.heading -= 2 * Math.PI;
  if (state.heading < -Math.PI) state.heading += 2 * Math.PI;
  state.x += Math.cos(state.heading) * v * dt;
  state.y += Math.sin(state.heading) * v * dt;
  state.odometer += Math.abs(v) * dt;
  return state;
}

/**
 * How much of the full steering lock a keyboard or thumb-stick may use at a
 * given speed. Without this, a key press at 50 km/h would mean full lock.
 * Returns a fraction 0..1 of full lock.
 */
export function steerAssistLimit(car, speedMs, comfortLatAccel = 3.5) {
  const v = Math.abs(speedMs);
  if (v < 1.5) return 1;
  const angle = Math.atan((comfortLatAccel * car.wheelbaseM) / (v * v));
  return clamp(angle / maxSteerRad(car), 0.03, 1);
}
