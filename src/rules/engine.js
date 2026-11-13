// The driving instructor: watches the drive and records what went wrong.
// Pure logic. It is fed one "sample" per tick and has no knowledge of
// graphics or input devices, so every rule can be unit tested.
//
// What is checked in this version:
//   fart          speeding
//   utenfor_vei   leaving the road
//   motgaende     driving in the oncoming lane
//   feil_retning  driving against a one-way street / roundabout
//   blinklys      turning without signalling
//   kollisjon     hitting a building
//   bra_brems, bra_gass, sving_fart   smoothness
//
// NOT checked yet: right of way, pedestrians, traffic lights, observation
// (mirrors/blind spot), distance to other traffic, parking.

import { wrapAngle } from '../geo.js';
import { RULES } from '../config.js';

const RAD = 180 / Math.PI;

/** Human-readable catalogue of event types: label, advice and a describe() for the report. */
export const EVENT_TYPES = {
  fart: {
    label: 'Fart over fartsgrensen',
    advice: 'Hold øye med fartsgrensen og speedometeret, særlig når du kommer inn i en ny sone.',
    describe: (e) =>
      `Opptil ${Math.round(e.maxKmh)} km/t i ${e.limit}-sone (${e.where}), i ${e.duration.toFixed(0)} s.`,
  },
  utenfor_vei: {
    label: 'Kjørt utenfor veien',
    advice: 'Senk farten før svinger og se langt fram, så du holder bilen på veien.',
    describe: (e) => `Bilen var utenfor veibanen ved ${e.where} i ${e.duration.toFixed(0)} s.`,
  },
  motgaende: {
    label: 'Kjørt i motgående kjørefelt',
    advice: 'Hold bilen til høyre for midtlinjen. Øv på plassering i svinger.',
    describe: (e) => `Lå i motgående felt på ${e.where} i ${e.duration.toFixed(0)} s.`,
  },
  feil_retning: {
    label: 'Kjørt mot kjøreretningen',
    advice: 'Se etter skilt for enveiskjøring, og kjør mot klokka i rundkjøringer.',
    describe: (e) => `Kjørte mot kjøreretningen i ${e.where}.`,
  },
  blinklys: {
    label: 'Manglende eller feil tegn (blinklys)',
    advice: 'Gi tegn i god tid før du svinger, og blink til høyre når du kjører ut av en rundkjøring.',
    describe: (e) =>
      e.wrongSide
        ? `Blinket feil vei da du svingte til ${e.direction} ved ${e.where}.`
        : e.roundabout
          ? `Kjørte ut av rundkjøringen ved ${e.where} uten å blinke til høyre.`
          : `Svingte til ${e.direction} ved ${e.where} uten blinklys.`,
  },
  kollisjon: {
    label: 'Kollisjon',
    advice: 'Tilpass farten og hold avstand til hindringer.',
    describe: (e) => `Kolliderte med en bygning ved ${e.where} i ${Math.round(e.speedKmh)} km/t.`,
  },
  bra_brems: {
    label: 'Brå oppbremsing',
    advice: 'Se lenger fram og brems tidligere og mykere.',
    describe: (e) => `Brå brems fra ${Math.round(e.speedKmh)} km/t ved ${e.where}.`,
  },
  bra_gass: {
    label: 'Brå akselerasjon',
    advice: 'Gi gass gradvis.',
    describe: (e) => `Brå akselerasjon ved ${e.where}.`,
  },
  sving_fart: {
    label: 'For høy fart i sving',
    advice: 'Brems ned før svingen, ikke i den.',
    describe: (e) => `Høy fart gjennom sving ved ${e.where} (${Math.round(e.speedKmh)} km/t).`,
  },
};

export function describeEvent(e) {
  return EVENT_TYPES[e.type].describe(e);
}

function sameRoad(a, b) {
  if (!a || !b) return false;
  return a.id === b.id || (a.name && a.name === b.name);
}

export class RuleEngine {
  constructor(rules = RULES) {
    this.rules = rules;
    this.events = [];
    this.stats = {
      duration: 0,
      distance: 0,
      maxKmh: 0,
      speedingTime: 0,
      movingTime: 0,
      turns: 0,
      turnsSignalled: 0,
    };
    this._open = {}; // episodes in progress, by rule
    this._cooldown = {}; // earliest time a rule may fire again
    this._pass = null; // junction passage in progress
    this._lastBlink = { left: -Infinity, right: -Infinity };
    this._fresh = [];
  }

  _emit(event) {
    event.id = this.events.length + 1;
    this.events.push(event);
    this._fresh.push(event);
    return event;
  }

  /**
   * Sustained-condition helper. While `active`, time accumulates; once it has
   * lasted `minDuration` an event is created and then kept up to date until
   * the condition ends.
   */
  _episode(key, active, s, minDuration, make, update) {
    let ep = this._open[key];
    if (active) {
      if (!ep) ep = this._open[key] = { duration: 0, event: null, data: {} };
      ep.duration += s.dt;
      if (update) update(ep.data);
      if (!ep.event && ep.duration >= minDuration) {
        ep.event = this._emit({ t: s.t, x: s.x, y: s.y, where: whereOf(s), ...make(ep.data) });
      }
      if (ep.event) {
        ep.event.duration = ep.duration;
        Object.assign(ep.event, ep.data);
      }
    } else if (ep) {
      delete this._open[key];
    }
  }

  _once(key, s, cooldown, event) {
    if (s.t < (this._cooldown[key] ?? -Infinity)) return;
    this._cooldown[key] = s.t + cooldown;
    this._emit({ t: s.t, x: s.x, y: s.y, where: whereOf(s), ...event });
  }

  /** Feed one sample. Returns the events that were created by this sample. */
  update(s) {
    const R = this.rules;
    this._fresh = [];
    const kmh = Math.abs(s.speed) * 3.6;
    const st = this.stats;
    st.duration += s.dt;
    st.distance += Math.abs(s.speed) * s.dt;
    st.maxKmh = Math.max(st.maxKmh, kmh);
    if (kmh > 2) st.movingTime += s.dt;
    if (s.blinker) this._lastBlink[s.blinker] = s.t;

    const road = s.road;
    const forward = s.speed > 0.5 && s.gear !== 'R';

    // --- Speeding.
    const limit = road ? road.maxspeed : null;
    const over = limit != null && kmh > limit + R.speedToleranceKmh;
    if (over) st.speedingTime += s.dt;
    // A new speed zone starts a new episode.
    if (this._open.fart && this._open.fart.data.limit !== limit) delete this._open.fart;
    this._episode(
      'fart',
      over,
      s,
      R.speedMinDurationS,
      (d) => ({ type: 'fart', severity: severityForSpeed(d.maxKmh - d.limit) }),
      (d) => {
        d.limit = limit;
        d.maxKmh = Math.max(d.maxKmh ?? 0, kmh);
        d.severity = severityForSpeed(d.maxKmh - limit);
      },
    );

    // --- Off the road.
    this._episode('utenfor_vei', s.edgeDist > R.offRoadMarginM && kmh > 1, s, R.offRoadMinDurationS, () => ({
      type: 'utenfor_vei',
      severity: 'alvorlig',
    }));

    // --- Oncoming lane.
    let oncoming = false;
    if (road && road.centerLine && !road.oneway && forward && s.speed > 2 && s.junctionDist > R.oncomingJunctionClearM) {
      const offsetRight = s.along > 0 ? -s.lateral : s.lateral;
      oncoming = offsetRight < -R.oncomingMarginM && s.edgeDist <= 0;
    }
    this._episode('motgaende', oncoming, s, R.oncomingMinDurationS, () => ({ type: 'motgaende', severity: 'alvorlig' }));

    // --- Wrong way in a one-way street.
    const wrongWay = !!road && road.oneway && s.along < 0 && forward && s.speed > 2 && s.edgeDist <= 0;
    this._episode('feil_retning', wrongWay, s, R.wrongWayMinDurationS, () => ({
      type: 'feil_retning',
      severity: 'alvorlig',
    }));

    // --- Collision.
    if (s.collided) this._once('kollisjon', s, 3, { type: 'kollisjon', severity: 'alvorlig', speedKmh: s.impactKmh ?? kmh });

    // --- Smoothness.
    if (s.accelLong < -R.harshBrakeMs2 && kmh > 15 && !s.collided) {
      this._once('bra_brems', s, 4, { type: 'bra_brems', severity: 'liten', speedKmh: kmh });
    }
    if (s.accelLong > R.harshAccelMs2 && kmh > 5) this._once('bra_gass', s, 4, { type: 'bra_gass', severity: 'liten' });
    this._episode('sving_fart', Math.abs(s.accelLat) > R.corneringMs2, s, 0.5, () => ({
      type: 'sving_fart',
      severity: 'liten',
      speedKmh: kmh,
    }));

    this._updateTurnSignal(s, forward);
    return this._fresh;
  }

  /** Turn-signal rule: follows the car through each junction and checks the indicator. */
  _updateTurnSignal(s, forward) {
    const R = this.rules;
    const inside = s.junctionDist <= R.junctionRadiusM;
    let p = this._pass;

    if (p && s.speed < -0.3) {
      this._pass = null; // reversing: not a normal passage
      return;
    }
    if (inside) {
      if (!p) {
        if (!forward) return; // standing still or creeping backwards: nothing to follow yet
        p = this._pass = {
          headingIn: s.heading,
          roadIn: s.road,
          where: s.junctionName,
          x: s.x,
          y: s.y,
          signalled: { left: false, right: false },
          sawRoundabout: false,
          signalledOnRoundabout: false,
          lastInside: s.t,
        };
        // Credit a signal given on the approach.
        for (const side of ['left', 'right']) if (s.t - this._lastBlink[side] < 3) p.signalled[side] = true;
      }
      p.lastInside = s.t;
      if (s.road && s.road.roundabout) p.sawRoundabout = true;
      // Only a signal given before the turn is well under way counts.
      if (s.blinker && Math.abs(wrapAngle(s.heading - p.headingIn)) < 25 / RAD) p.signalled[s.blinker] = true;
      if (s.blinker === 'right' && p.sawRoundabout) p.signalledOnRoundabout = true;
      return;
    }
    if (!p || s.t - p.lastInside < 0.4) return;

    // The car has left the junction: judge the passage.
    this._pass = null;
    const turn = wrapAngle(s.heading - p.headingIn) * RAD; // + = left
    const roadOut = s.road;
    let required = null;
    let roundabout = false;
    if (p.sawRoundabout) {
      if (roadOut && roadOut.roundabout) return; // still circulating (large roundabout)
      if (p.roadIn && p.roadIn.roundabout && !roadOut) return;
      required = 'right';
      roundabout = true;
    } else if (Math.abs(turn) >= R.turnMinAngleDeg && Math.abs(turn) <= 150 && !sameRoad(p.roadIn, roadOut)) {
      required = turn > 0 ? 'left' : 'right';
    }
    if (!required) return;

    this.stats.turns++;
    const ok = roundabout ? p.signalledOnRoundabout : p.signalled[required];
    if (ok) {
      this.stats.turnsSignalled++;
      return;
    }
    const other = required === 'left' ? 'right' : 'left';
    this._emit({
      type: 'blinklys',
      severity: 'middels',
      t: s.t,
      x: p.x,
      y: p.y,
      where: p.where || whereOf(s),
      direction: required === 'left' ? 'venstre' : 'høyre',
      wrongSide: !roundabout && p.signalled[other],
      roundabout,
    });
  }
}

function whereOf(s) {
  if (s.junctionDist <= 20 && s.junctionName) return s.junctionName;
  return s.road ? s.road.label : 'utenfor vei';
}

function severityForSpeed(overKmh) {
  return overKmh > 10 ? 'alvorlig' : overKmh > 5 ? 'middels' : 'liten';
}
