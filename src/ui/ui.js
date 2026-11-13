// Everything the user sees outside the 3D picture: menu, instruments while
// driving, pause, and the report. Talks to the page (DOM) only.

import { VERSION, AREAS } from '../config.js';
import { CARS } from '../vehicle/cars.js';
import { EVENT_TYPES, describeEvent } from '../rules/engine.js';
import { drawMinimap, drawRouteMap } from './minimap.js';

const $ = (id) => document.getElementById(id);

function show(id, on) {
  $(id).classList.toggle('hidden', !on);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) node.append(c);
  return node;
}

function formatDuration(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export class UI {
  constructor() {
    $('version').textContent = VERSION;
    for (const a of Object.values(AREAS)) $('areaSel').append(el('option', { value: a.id, text: a.name }));
    for (const c of Object.values(CARS)) $('carSel').append(el('option', { value: c.id, text: `${c.name} – automat` }));
    this._lastHud = {};
    this._mapTick = 0;
    this._helpTimer = null;
  }

  // ---------- Menu
  showMenu(on) {
    show('menu', on);
  }
  setMapStatus(text, warn = false) {
    $('mapStatus').textContent = text;
    $('mapStatus').classList.toggle('warn', warn);
  }
  setStartEnabled(on) {
    $('startBtn').disabled = !on;
  }
  setPadStatus(summary) {
    $('padStatus').textContent = summary.text;
    $('calibBtn').disabled = !summary.found;
  }
  get mode() {
    return $('modeSel').value;
  }
  get mirrors() {
    return $('mirrorChk').checked;
  }
  set mirrors(on) {
    $('mirrorChk').checked = on;
  }
  on(id, fn) {
    $(id).addEventListener('click', (e) => {
      e.currentTarget.blur();
      fn(e);
    });
  }

  // ---------- While driving
  showHud(on) {
    show('hud', on);
    if (on) {
      $('toasts').textContent = '';
      $('help').style.opacity = '1';
      clearTimeout(this._helpTimer);
      this._helpTimer = setTimeout(() => ($('help').style.opacity = '0'), 12000);
    }
  }
  showPause(on) {
    show('pause', on);
  }

  updateHud({ kmh, gear, blinker, blinkOn, road, showLimit, fps, scale, net, x, y, heading }) {
    const last = this._lastHud;
    const set = (key, value, apply) => {
      if (last[key] !== value) {
        last[key] = value;
        apply(value);
      }
    };
    set('kmh', Math.round(kmh), (v) => ($('speed').textContent = v));
    set('gear', gear, (v) => ($('gear').textContent = v));
    set('bl', blinker === 'left' && blinkOn, (v) => $('blinkL').classList.toggle('on', v));
    set('br', blinker === 'right' && blinkOn, (v) => $('blinkR').classList.toggle('on', v));
    set('street', road ? road.label : 'Utenfor vei', (v) => ($('streetName').textContent = v));
    set('limitShown', showLimit && !!road, (v) => $('limit').classList.toggle('hidden', !v));
    if (road) {
      set('limit', road.maxspeed, (v) => ($('limit').textContent = v));
      set('assumed', road.maxspeedSource === 'antatt', (v) => {
        $('limit').classList.toggle('assumed', v);
        $('limit').title = v ? 'Fartsgrense antatt (mangler i kartet)' : 'Fartsgrense';
      });
      const info = road.restricted ? 'Ikke åpen for vanlig biltrafikk (ifølge kartet)' : road.oneway ? 'Enveiskjørt' : '';
      set('info', info, (v) => ($('streetInfo').textContent = v));
    }
    set('fps', `${Math.round(fps)} b/s · ${Math.round(scale * 100)} %`, (v) => ($('fps').textContent = v));
    if (this._mapTick++ % 4 === 0) drawMinimap($('minimap'), net, x, y, heading);
  }

  toast(text, kind = 'middels', seconds = 4.5) {
    const box = $('toasts');
    const t = el('div', { class: `toast ${kind}`, text });
    box.append(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.remove(), seconds * 1000);
  }

  toastEvent(e) {
    const type = EVENT_TYPES[e.type];
    // Events that are still developing (speeding ...) get their label; finished ones their full text.
    const text = e.duration == null ? describeEvent(e) : type.label;
    this.toast(text, e.severity);
  }

  // ---------- Report
  showReport(on) {
    show('report', on);
  }

  renderReport(report, ctx) {
    $('reportSub').textContent = `${ctx.areaName} · ${ctx.carName} · ${ctx.modeName} · ${new Date().toLocaleString('nb-NO')}`;

    const v = $('verdict');
    v.className = `verdict ${report.verdict}`;
    v.textContent = '';
    v.append(
      el('div', { class: 'badge', text: report.title }),
      el('div', {}, [
        el('ul', {}, report.reasons.map((r) => el('li', { text: r }))),
        el('div', { class: 'fine', style: 'margin-top:4px', text: 'Veiledende vurdering. Se hva som ikke er vurdert nederst.' }),
      ]),
    );

    const s = report.stats;
    const stats = [
      [formatDuration(s.durationS), 'varighet'],
      [`${(s.distanceM / 1000).toFixed(2)} km`, 'kjørt'],
      [`${Math.round(s.avgKmh)} km/t`, 'snittfart'],
      [`${Math.round(s.maxKmh)} km/t`, 'toppfart'],
      [`${Math.round(s.speedingShare * 100)} %`, 'av tiden over fartsgrensen'],
      [`${s.turnsSignalled} av ${s.turns}`, 'svinger med riktig blinklys'],
    ];
    $('reportStats').textContent = '';
    for (const [value, label] of stats) {
      $('reportStats').append(el('div', { class: 'stat' }, [el('b', { text: value }), el('span', { text: label })]));
    }

    const groups = $('reportGroups');
    groups.textContent = '';
    if (!report.groups.length) groups.append(el('p', { class: 'sub', text: 'Ingen anmerkninger.' }));
    for (const g of report.groups) {
      groups.append(
        el('div', { class: 'group' }, [
          el('header', {}, [
            el('b', { text: `${g.label} (${g.items.length})` }),
            el('span', { class: `pill ${g.severity}`, text: g.severityLabel }),
          ]),
          el('ol', {}, g.items.map((i) => el('li', { value: i.id, text: `${formatDuration(i.t)} – ${i.text}` }))),
        ]),
      );
    }

    const advice = $('reportAdvice');
    advice.textContent = '';
    for (const a of report.advice.length ? report.advice : ['Fortsett slik. Prøv en lengre økt eller prøvemodus.']) {
      advice.append(el('li', { text: a }));
    }
    const not = $('reportNot');
    not.textContent = '';
    for (const n of report.notAssessed) not.append(el('li', { text: n }));
    $('reportScoring').textContent = `Slik er vurderingen regnet ut: ${report.scoring}`;

    drawRouteMap($('reportMap'), ctx.net, ctx.path, report.groups.flatMap((g) => g.items));
  }
}
