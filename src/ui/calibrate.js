// Calibration wizard for steering wheel, pedals and buttons.
// It asks the user to move one control at a time and notes which axis or
// button changed, so it works whatever numbering the device uses.

const $ = (id) => document.getElementById(id);

const STEPS = [
  { key: 'rest', text: 'Hold rattet rett fram og slipp alle pedaler. Trykk Neste.' },
  { key: 'left', text: 'Vri rattet helt til VENSTRE og hold det der. Trykk Neste.' },
  { key: 'right', text: 'Vri rattet helt til HØYRE og hold det der. Trykk Neste.' },
  { key: 'throttle', text: 'Trå GASSPEDALEN helt inn og hold den. Trykk Neste.' },
  { key: 'brake', text: 'Trå BREMSEPEDALEN helt inn og hold den. Trykk Neste.' },
  { key: 'clutch', text: 'Trå CLUTCHEN helt inn og hold den. Trykk Neste. (Har du ikke clutch: Hopp over.)', optional: true },
  { key: 'blinkLeft', text: 'Hold inne knappen du vil bruke til VENSTRE blinklys. Trykk Neste.', optional: true, button: true },
  { key: 'blinkRight', text: 'Hold inne knappen du vil bruke til HØYRE blinklys. Trykk Neste.', optional: true, button: true },
];

function biggestChange(now, rest, exclude) {
  let best = -1;
  let bestDelta = 0;
  now.axes.forEach((v, i) => {
    if (exclude.has(i)) return;
    const d = Math.abs(v - rest.axes[i]);
    if (d > bestDelta) {
      bestDelta = d;
      best = i;
    }
  });
  return { axis: best, delta: bestDelta };
}

export class Calibration {
  constructor(input, onDone) {
    this.input = input;
    this.onDone = onDone;
    this.active = false;
    $('calibNext').addEventListener('click', () => this._next(false));
    $('calibSkip').addEventListener('click', () => this._next(true));
    $('calibCancel').addEventListener('click', () => this.close(false));
  }

  open() {
    const pad = this.input.rawPad();
    if (!pad) return;
    this.active = true;
    this.padId = pad.id;
    this.step = 0;
    this.rest = null;
    this.used = new Set();
    this.cfg = { type: 'wheel', rangeDeg: 900, buttons: {} };
    $('calibPad').textContent = pad.id;
    $('calib').classList.remove('hidden');
    this._show();
    this._tick();
  }

  close(saved) {
    this.active = false;
    $('calib').classList.add('hidden');
    this.onDone(saved);
  }

  _show(message = '') {
    const s = STEPS[this.step];
    $('calibStep').textContent = `${this.step + 1} av ${STEPS.length}: ${s.text}`;
    $('calibMsg').textContent = message;
    $('calibSkip').classList.toggle('hidden', !s.optional);
  }

  /** Live read-out of every axis and button. Useful when something does not respond. */
  _tick() {
    if (!this.active) return;
    const pad = this.input.rawPad();
    const box = $('axes');
    box.textContent = '';
    if (pad) {
      pad.axes.forEach((v, i) => {
        const row = document.createElement('div');
        const bar = document.createElement('span');
        bar.className = 'bar';
        const mark = document.createElement('i');
        mark.style.left = `${((v + 1) / 2) * 100}%`;
        bar.append(mark);
        row.append(`Akse ${i} `, bar, ` ${v.toFixed(2)}`);
        box.append(row);
      });
      const pressed = pad.buttons.map((b, i) => (b ? i : null)).filter((i) => i != null);
      const row = document.createElement('div');
      row.textContent = `Knapper inne: ${pressed.length ? pressed.join(', ') : 'ingen'}`;
      box.append(row);
    } else {
      box.textContent = 'Mistet kontakten med rattet.';
    }
    requestAnimationFrame(() => this._tick());
  }

  _next(skip) {
    const s = STEPS[this.step];
    const now = this.input.rawPad();
    if (!now) return this._show('Finner ikke rattet. Sjekk kabelen og trykk en knapp på det.');
    if (!(skip && s.optional)) {
      if (s.key === 'rest') {
        this.rest = now;
      } else if (s.key === 'left') {
        const c = biggestChange(now, this.rest, this.used);
        if (c.delta < 0.15) return this._show('Så ingen bevegelse i rattet. Vri helt til venstre og prøv igjen.');
        this.cfg.steer = { axis: c.axis, left: now.axes[c.axis] };
        this.used.add(c.axis);
      } else if (s.key === 'right') {
        const axis = this.cfg.steer.axis;
        const v = now.axes[axis];
        if (Math.abs(v - this.cfg.steer.left) < 0.3) return this._show('Rattet står nesten likt som i forrige steg. Vri helt til høyre og prøv igjen.');
        this.cfg.steer.right = v;
      } else if (s.button) {
        const index = now.buttons.findIndex((b, i) => b && !this.rest.buttons[i]);
        if (index < 0) return this._show('Så ingen knapp. Hold knappen inne mens du trykker Neste, eller hopp over.');
        this.cfg.buttons[s.key] = index;
      } else {
        const c = biggestChange(now, this.rest, this.used);
        if (c.delta < 0.25) return this._show('Så ingen bevegelse i pedalen. Trå den helt inn og prøv igjen.');
        this.cfg[s.key] = { axis: c.axis, rest: this.rest.axes[c.axis], full: now.axes[c.axis] };
        this.used.add(c.axis);
      }
    }
    this.step++;
    if (this.step >= STEPS.length) {
      this.input.saveConfig(this.padId, this.cfg);
      this.close(true);
    } else {
      this._show();
    }
  }
}
