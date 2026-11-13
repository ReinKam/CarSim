// Sound: road/wind noise that follows the speed, and the indicator tick.
// Kept very simple; an electric car has no engine note to speak of.

export class Audio {
  constructor() {
    this.ctx = null;
  }

  /** Must be called from a click or key press (browser rule). */
  start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
      const len = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        // brown-ish noise
        last = (last + (Math.random() * 2 - 1) * 0.06) * 0.985;
        data[i] = last * 3;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 200;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      noise.connect(this.filter).connect(this.gain).connect(this.ctx.destination);
      noise.start();
    } catch {
      this.ctx = null;
    }
  }

  setSpeed(kmh, running) {
    if (!this.ctx) return;
    const k = Math.min(Math.abs(kmh) / 100, 1.3);
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(running ? 0.05 + k * 0.5 : 0, t, 0.15);
    this.filter.frequency.setTargetAtTime(180 + k * 900, t, 0.15);
  }

  tick(high) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = high ? 1500 : 1100;
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }
}
