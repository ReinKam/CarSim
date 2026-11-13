// Application entry point: loads the map, builds the world and runs the
// session loop (menu -> driving -> report).

import { AREAS, DEFAULT_AREA, DEFAULT_CAR, VERSION } from './config.js';
import { CARS } from './vehicle/cars.js';
import { loadAreaData, clearSavedMap } from './map/osm.js';
import { makeDemoOsm } from './map/demo-area.js';
import { buildRoadNet } from './map/roadnet.js';
import { buildWorld } from './world/build.js';
import { createCarVisual } from './world/car.js';
import { Simulation } from './sim.js';
import { buildReport } from './rules/report.js';
import { View } from './view.js';
import { Input } from './input/input.js';
import { UI } from './ui/ui.js';
import { Calibration } from './ui/calibrate.js';
import { Audio } from './audio.js';

const STEP = 1 / 120; // physics time step, seconds
const params = new URLSearchParams(location.search);

const area = AREAS[DEFAULT_AREA];
const car = CARS[DEFAULT_CAR];
const ui = new UI();
const view = new View(document.getElementById('view'));
const input = new Input(car);
const audio = new Audio();
const calibration = new Calibration(input, () => {
  input.enabled = true;
  ui.setPadStatus(input.padSummary());
});

let net = null;
let sim = null;
let mapSource = '';
let state = 'loading'; // loading | menu | driving | paused | report
let lastReport = null;
let headYaw = 0;
let blinkClock = 0;
let blinkOn = false;
let lostFor = 0;
let fpsSum = 0;
let fpsCount = 0;

function setState(next) {
  state = next;
  ui.showMenu(next === 'menu' || next === 'loading');
  ui.showHud(next === 'driving' || next === 'paused');
  ui.showPause(next === 'paused');
  ui.showReport(next === 'report');
  input.reset();
}

async function loadWorld(forceDemo = false) {
  setState('loading');
  ui.setStartEnabled(false);
  ui.setMapStatus(`Laster kart for ${area.name} …`);
  let data;
  if (forceDemo) data = { osm: makeDemoOsm(area), source: 'øvingsbane', note: '' };
  else data = await loadAreaData(area, (t) => ui.setMapStatus(t));

  let world;
  try {
    net = buildRoadNet(data.osm, area);
    if (net.roads.length < 3) throw new Error('for få veier i kartdataene');
    world = buildWorld(net, area);
  } catch (err) {
    console.error('Kunne ikke bygge verden fra kartdata:', err);
    data = {
      osm: makeDemoOsm(area),
      source: 'øvingsbane',
      note: `Kartet for ${area.name} kunne ikke brukes (${err.message}). Viser en enkel øvingsbane i stedet.`,
    };
    net = buildRoadNet(data.osm, area);
    world = buildWorld(net, area);
  }
  mapSource = data.source;
  view.setWorld(world);
  view.setCar(createCarVisual(car));
  sim = new Simulation(net, car);

  const s = world.stats;
  const summary = `${s.roadsKm.toFixed(1)} km vei, ${s.buildings} bygninger, ${net.junctions.length} kryss`;
  if (data.source === 'øvingsbane') {
    ui.setMapStatus(data.note || `Øvingsbane: ${summary}.`, !!data.note);
  } else {
    const how = { pakket: 'fulgte med appen', lagret: 'lagret i nettleseren', hentet: 'hentet fra OpenStreetMap nå' }[data.source];
    ui.setMapStatus(`Klar: ${area.name} – ${summary}. Kartet er ${how}.`);
  }
  ui.setStartEnabled(true);
  setState('menu');
}

function startSession() {
  audio.start();
  sim.reset();
  view.mirrorsOn = ui.mirrors;
  view.mode = 'driver';
  headYaw = 0;
  lostFor = 0;
  fpsSum = fpsCount = 0;
  setState('driving');
}

function endSession() {
  lastReport = buildReport(sim.engine);
  ui.renderReport(lastReport, {
    net,
    path: sim.path,
    areaName: mapSource === 'øvingsbane' ? 'Øvingsbane' : area.name,
    carName: car.name,
    modeName: ui.mode === 'prove' ? 'Prøve' : 'Øvingskjøring',
  });
  audio.setSpeed(0, false);
  setState('report');
}

function saveSession() {
  const payload = {
    app: 'CarSim',
    version: VERSION,
    savedAt: new Date().toISOString(),
    area: area.id,
    mapSource,
    car: car.id,
    mode: ui.mode,
    device: {
      userAgent: navigator.userAgent,
      screen: `${screen.width}x${screen.height} @${window.devicePixelRatio}`,
      avgFps: fpsCount ? Math.round(fpsSum / fpsCount) : null,
      renderScale: view.scale,
      controls: input.padSummary().text,
    },
    report: lastReport,
    path: sim.path.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `carsim-okt-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Commands from keyboard / wheel buttons
input.onAction((action) => {
  if (calibration.active) return;
  if (state === 'paused') {
    if (action === 'pause') setState('driving');
    return;
  }
  if (state !== 'driving') return;
  switch (action) {
    case 'blinkLeft':
      sim.toggleBlinker('left');
      break;
    case 'blinkRight':
      sim.toggleBlinker('right');
      break;
    case 'reverse':
      if (!sim.toggleReverse()) ui.toast('Stans bilen helt før du skifter mellom D og R.', 'info', 3);
      break;
    case 'camera':
      view.mode = view.mode === 'driver' ? 'chase' : 'driver';
      break;
    case 'mirrors':
      view.mirrorsOn = !view.mirrorsOn;
      ui.mirrors = view.mirrorsOn;
      break;
    case 'recover':
      sim.recover();
      ui.toast('Bilen er satt tilbake på veien.', 'info', 3);
      break;
    case 'pause':
      audio.setSpeed(0, false);
      setState('paused');
      break;
    case 'end':
      endSession();
      break;
  }
});

// ---------- Buttons
ui.on('startBtn', startSession);
ui.on('againBtn', startSession);
ui.on('menuBtn', () => setState('menu'));
ui.on('quitBtn', () => setState('menu'));
ui.on('resumeBtn', () => setState('driving'));
ui.on('endBtn', endSession);
ui.on('saveBtn', saveSession);
ui.on('fullBtn', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});
ui.on('reloadMapBtn', () => {
  clearSavedMap(area);
  loadWorld();
});
ui.on('calibBtn', () => {
  input.enabled = false;
  calibration.open();
});
window.addEventListener('resize', () => view.resize());
window.addEventListener('gamepadconnected', () => ui.setPadStatus(input.padSummary()));
window.addEventListener('gamepaddisconnected', () => ui.setPadStatus(input.padSummary()));

// ---------- Main loop
let last = performance.now();
let acc = 0;
let padPoll = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!sim) return;

  if (state === 'menu' && (padPoll += dt) > 0.5) {
    padPoll = 0;
    ui.setPadStatus(input.padSummary());
  }

  let controls = { throttle: 0, brake: 0, steer: 0, look: 0 };
  if (state === 'driving') {
    controls = input.poll(dt, sim.state.v);
    acc += dt;
    while (acc >= STEP) {
      const fresh = sim.step(STEP, controls);
      if (fresh.length && ui.mode === 'ov') for (const e of fresh) ui.toastEvent(e);
      acc -= STEP;
    }

    // Indicator lamp and tick
    if (sim.blinker) {
      blinkClock += dt;
      const on = blinkClock % 0.8 < 0.4;
      if (on !== blinkOn) audio.tick(on);
      blinkOn = on;
    } else {
      blinkClock = 0;
      blinkOn = false;
    }

    // Driver's head follows the look keys smoothly
    const yawTarget = controls.look * 1.3;
    headYaw += (yawTarget - headYaw) * Math.min(1, dt * 9);
    view.headYaw = headYaw;

    lostFor = sim.loc ? 0 : lostFor + dt;
    if (lostFor > 2) {
      ui.toast('Du er utenfor kartet. Trykk T for å sette bilen tilbake på veien.', 'info', 5);
      lostFor = -8;
    }

    fpsSum += view.fps;
    fpsCount++;
    audio.setSpeed(sim.state.v * 3.6, true);
    ui.updateHud({
      kmh: Math.abs(sim.state.v) * 3.6,
      gear: sim.state.gear,
      blinker: sim.blinker,
      blinkOn,
      road: sim.loc && sim.loc.edgeDist < 3 ? sim.loc.road : null,
      showLimit: ui.mode === 'ov',
      fps: view.fps,
      scale: view.scale,
      net,
      x: sim.centre.x,
      y: sim.centre.y,
      heading: sim.state.heading,
    });
  }

  view.carVisual.update(sim.state, { brake: controls.brake, blinker: sim.blinker, blinkOn });
  view.render(dt, sim.state);
}

// Handy for automated tests and for debugging in the browser console.
window.carsim = {
  get sim() { return sim; },
  get net() { return net; },
  get state() { return state; },
  view,
  input,
  start: startSession,
  end: endSession,
};

loadWorld(params.has('demo')).then(() => requestAnimationFrame(frame));
