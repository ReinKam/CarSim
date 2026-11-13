// Input from keyboard, game controller and steering wheel with pedals.
//
// poll() returns analogue controls:
//   throttle 0..1, brake 0..1, clutch 0..1, steer -1..1 (+1 = full right lock),
//   look -1..1 (+1 = looking left)
// One-shot commands (indicators, reverse, camera ...) are delivered to the
// callback given to onAction().
//
// Wheels differ in how they number their axes, so nothing is assumed: the
// calibration wizard (ui/calibrate.js) learns which axis is which and saves
// it in this browser.

import { clamp } from '../geo.js';
import { steerAssistLimit } from '../vehicle/physics.js';

const KEY_ACTIONS = {
  KeyQ: 'blinkLeft',
  KeyE: 'blinkRight',
  KeyR: 'reverse',
  KeyC: 'camera',
  KeyM: 'mirrors',
  KeyT: 'recover',
  KeyP: 'pause',
  Escape: 'pause',
  Enter: 'end',
  NumpadEnter: 'end',
};
const HELD = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'KeyZ', 'KeyX',
]);

/** Layout used for ordinary controllers that report the "standard" mapping (e.g. Xbox). */
const STANDARD_PAD = {
  type: 'pad',
  steer: { axis: 0 },
  look: { axis: 2 },
  throttle: { button: 7 },
  brake: { button: 6 },
  buttons: { blinkLeft: 4, blinkRight: 5, reverse: 3, camera: 2, end: 9, pause: 8 },
};

function storageKey(id) {
  return 'carsim.pad.v1.' + id;
}

function approach(value, target, rate, dt) {
  const d = target - value;
  const max = rate * dt;
  return Math.abs(d) <= max ? target : value + Math.sign(d) * max;
}

export class Input {
  constructor(car) {
    this.car = car;
    this.keys = new Set();
    this.listener = () => {};
    this.kb = { throttle: 0, brake: 0, steer: 0 };
    this.padSteer = 0;
    this.padButtons = [];
    this.configs = new Map(); // pad id -> config (cache of localStorage)
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      if (HELD.has(e.code)) {
        this.keys.add(e.code);
        e.preventDefault();
      } else if (KEY_ACTIONS[e.code] && !e.repeat) {
        this.listener(KEY_ACTIONS[e.code]);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onAction(fn) {
    this.listener = fn;
  }

  // ---------- Game controller / wheel

  /** The first connected controller, or null. */
  pad() {
    if (!navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }

  /** Raw values, for the calibration wizard. */
  rawPad() {
    const p = this.pad();
    if (!p) return null;
    return { id: p.id, mapping: p.mapping, axes: [...p.axes], buttons: p.buttons.map((b) => b.pressed || b.value > 0.5) };
  }

  configFor(pad) {
    if (this.configs.has(pad.id)) return this.configs.get(pad.id);
    let cfg = null;
    try {
      const raw = localStorage.getItem(storageKey(pad.id));
      if (raw) cfg = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    if (!cfg && pad.mapping === 'standard') cfg = STANDARD_PAD;
    this.configs.set(pad.id, cfg);
    return cfg;
  }

  saveConfig(id, cfg) {
    this.configs.set(id, cfg);
    try {
      localStorage.setItem(storageKey(id), JSON.stringify(cfg));
    } catch {
      /* ignore: works until the page is closed */
    }
  }

  /** Short description for the menu. */
  padSummary() {
    const p = this.pad();
    if (!p) return { found: false, text: 'Ingen ratt eller kontroller funnet. Koble til og trykk en knapp på den.' };
    const cfg = this.configFor(p);
    const name = p.id.replace(/\s*\(.*?Vendor.*?\)\s*/i, '').trim() || p.id;
    if (!cfg) return { found: true, calibrated: false, text: `Funnet: ${name}. Må kalibreres før bruk.` };
    if (cfg.type === 'wheel') return { found: true, calibrated: true, text: `Ratt i bruk: ${name} (kalibrert).` };
    return { found: true, calibrated: true, text: `Kontroller i bruk: ${name}. Kalibrer hvis dette er et ratt.` };
  }

  _readPedal(pad, def) {
    if (!def) return 0;
    if (def.button != null) return pad.buttons[def.button] ? pad.buttons[def.button].value : 0;
    const v = pad.axes[def.axis] ?? def.rest;
    const x = (v - def.rest) / (def.full - def.rest || 1);
    return clamp((x - 0.03) / 0.94, 0, 1);
  }

  _pollPad(dt, speed) {
    const out = { active: false, throttle: 0, brake: 0, clutch: 0, steer: 0, look: 0 };
    const pad = this.pad();
    const cfg = pad && this.configFor(pad);
    if (!cfg) return out;
    out.active = true;
    out.throttle = this._readPedal(pad, cfg.throttle);
    out.brake = this._readPedal(pad, cfg.brake);
    out.clutch = this._readPedal(pad, cfg.clutch);

    if (cfg.type === 'wheel') {
      const s = cfg.steer;
      const centre = (s.left + s.right) / 2;
      const raw = ((pad.axes[s.axis] ?? centre) - centre) / ((s.right - s.left) / 2 || 1);
      // The wheel turns further than the car's steering: scale so one turn of the wheel is one turn in the car.
      out.steer = clamp(raw * ((cfg.rangeDeg || 900) / this.car.lockToLockDeg), -1, 1);
    } else {
      // Thumb-stick: dead zone, soft curve, and less lock at speed.
      let v = pad.axes[cfg.steer.axis] || 0;
      v = Math.abs(v) < 0.1 ? 0 : (v - Math.sign(v) * 0.1) / 0.9;
      const target = v * Math.abs(v) * steerAssistLimit(this.car, speed);
      this.padSteer = approach(this.padSteer, target, 2.5, dt);
      out.steer = this.padSteer;
      const look = pad.axes[cfg.look?.axis] || 0;
      out.look = Math.abs(look) > 0.3 ? -look : 0;
    }

    // Buttons: fire once when pressed.
    const map = cfg.buttons || {};
    for (const [action, index] of Object.entries(map)) {
      if (index == null) continue;
      const down = !!(pad.buttons[index] && pad.buttons[index].pressed);
      if (down && !this.padButtons[index]) this.listener(action);
      this.padButtons[index] = down;
    }
    return out;
  }

  // ---------- Combined

  poll(dt, speed) {
    const k = this.keys;
    const kb = this.kb;
    const has = (...codes) => codes.some((c) => k.has(c));

    // Keys are on/off, pedals are not: ramp the values so the car does not jerk.
    const gas = has('KeyW', 'ArrowUp');
    const full = has('ShiftLeft', 'ShiftRight');
    kb.throttle = approach(kb.throttle, gas ? (full ? 1 : 0.5) : 0, gas ? 1.3 : 3.5, dt);
    const emergency = k.has('Space');
    const braking = has('KeyS', 'ArrowDown');
    kb.brake = approach(kb.brake, emergency ? 1 : braking ? 0.55 : 0, emergency ? 7 : braking ? 2.2 : 5, dt);

    const dir = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0);
    const limit = steerAssistLimit(this.car, speed);
    const rate = Math.max(limit, 0.06) * (dir !== 0 ? 1.8 : 2.8) + 0.05;
    kb.steer = approach(clamp(kb.steer, -limit, limit), dir * limit, rate, dt);

    const pad = this._pollPad(dt, speed);
    const kbLook = (k.has('KeyZ') ? 1 : 0) - (k.has('KeyX') ? 1 : 0);
    return {
      throttle: Math.max(kb.throttle, pad.throttle),
      brake: Math.max(kb.brake, pad.brake),
      clutch: pad.clutch,
      steer: dir !== 0 || !pad.active ? kb.steer : Math.abs(pad.steer) > 0.004 ? pad.steer : kb.steer,
      look: kbLook !== 0 ? kbLook : pad.look,
      source: pad.active ? 'kontroller' : 'tastatur',
    };
  }

  reset() {
    this.kb.throttle = this.kb.brake = this.kb.steer = 0;
    this.padSteer = 0;
    this.keys.clear();
  }
}
