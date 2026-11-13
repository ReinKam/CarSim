// Rendering: the main camera (driver's seat or outside view), three mirrors,
// and automatic resolution scaling so weak graphics hardware keeps a usable
// frame rate.

import * as THREE from 'three';
import { clamp } from './geo.js';

const MIRRORS = {
  rear: { w: 512, h: 150, fov: 22 },
  left: { w: 256, h: 176, fov: 17 },
  right: { w: 256, h: 176, fov: 17 },
};

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.12, 1600);
    this.camera.rotation.order = 'YXZ';
    this.mode = 'driver'; // 'driver' | 'chase'
    this.mirrorsOn = true;
    this.headYaw = 0; // radians, + = looking left
    this.scale = 1; // render resolution relative to CSS pixels
    this.maxScale = Math.min(window.devicePixelRatio || 1, 1.5);
    this.scale = Math.min(1, this.maxScale);
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._frame = 0;
    this._lowFor = 0;
    this._highFor = 0;
    this._trial = null;
    this._lockedFor = 0;

    // Mirrors: each is rendered to a small texture and drawn on top of the picture.
    this.mirrors = {};
    this.overlay = new THREE.Scene();
    this.overlayCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    for (const [name, cfg] of Object.entries(MIRRORS)) {
      const target = new THREE.WebGLRenderTarget(cfg.w, cfg.h);
      const cam = new THREE.PerspectiveCamera(cfg.fov, cfg.w / cfg.h, 0.3, 700);
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#0d0f11' }));
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: target.texture, side: THREE.DoubleSide }),
      );
      this.overlay.add(frame, glass);
      this.mirrors[name] = { target, cam, frame, glass, aspect: cfg.w / cfg.h };
    }
    this.resize();
  }

  setWorld(world) {
    if (this.world) this.scene.remove(this.world.group);
    this.world = world;
    this.scene.add(world.group);
    this.scene.background = world.background;
    this.scene.fog = world.fog;
  }

  setCar(visual) {
    if (this.carVisual) this.scene.remove(this.carVisual.group);
    this.carVisual = visual;
    this.scene.add(visual.group);
    visual.head.add(this.camera);
    for (const [name, m] of Object.entries(this.mirrors)) visual.mirrorMounts[name].add(m.cam);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.scale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 62 degrees up-down suits a wide screen. On a narrow window, widen it so the
    // driver still sees about 84 degrees left-right.
    const wanted = (2 * Math.atan(Math.tan((84 * Math.PI) / 360) / (w / h)) * 180) / Math.PI;
    this.camera.fov = clamp(wanted, 62, 100);
    this.camera.updateProjectionMatrix();

    // Lay out the mirrors in CSS pixels (y measured from the bottom).
    this.overlayCam.right = w;
    this.overlayCam.top = h;
    this.overlayCam.updateProjectionMatrix();
    const place = (m, cx, cy, mw) => {
      const mh = mw / m.aspect;
      m.frame.position.set(cx, cy, 0);
      m.frame.scale.set(mw + 8, mh + 8, 1);
      m.glass.position.set(cx, cy, 0.1);
      m.glass.scale.set(-mw, mh, 1); // negative width = mirrored left/right, like a real mirror
    };
    const rearW = clamp(w * 0.27, 220, 520);
    place(this.mirrors.rear, w / 2, h - 16 - rearW / this.mirrors.rear.aspect / 2, rearW);
    const sideW = clamp(w * 0.15, 130, 300);
    const sideY = h * 0.5;
    place(this.mirrors.left, 14 + sideW / 2, sideY, sideW);
    place(this.mirrors.right, w - 14 - sideW / 2, sideY, sideW);
  }

  /**
   * Keep the frame rate usable by lowering or raising the render resolution.
   * A lower resolution only helps when the graphics chip is the bottleneck, so
   * after each reduction we check that it actually helped. If it did not (for
   * example a 30 Hz screen, or a browser that limits the frame rate), the
   * resolution is restored and left alone.
   */
  _adaptResolution(dt) {
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc < 1) return;
    this.fps = this._fpsFrames / this._fpsAcc;
    this._fpsAcc = 0;
    this._fpsFrames = 0;

    if (this._trial) {
      if (--this._trial.wait > 0) return;
      if (this.fps < this._trial.fpsBefore * 1.15) {
        this.scale = this._trial.scaleBefore;
        this._lockedFor = 60; // seconds
        this.resize();
      }
      this._trial = null;
      this._lowFor = this._highFor = 0;
      return;
    }
    if (this._lockedFor > 0) this._lockedFor--;

    if (this.fps < 40) {
      this._lowFor++;
      this._highFor = 0;
    } else if (this.fps > 57) {
      this._highFor++;
      this._lowFor = 0;
    } else {
      this._lowFor = this._highFor = 0;
    }
    if (this._lowFor >= 2 && this.scale > 0.5 && !(this._lockedFor > 0)) {
      this._trial = { fpsBefore: this.fps, scaleBefore: this.scale, wait: 2 };
      this.scale = Math.max(0.5, this.scale - 0.2);
      this.resize();
    } else if (this._highFor >= 5 && this.scale < this.maxScale) {
      this.scale = Math.min(this.maxScale, this.scale + 0.125);
      this._lowFor = this._highFor = 0;
      this.resize();
    }
  }

  render(dt, state) {
    this._adaptResolution(dt);
    const r = this.renderer;
    const car = this.carVisual;
    const driver = this.mode === 'driver';

    // --- Main camera
    if (driver) {
      if (this.camera.parent !== car.head) car.head.add(this.camera);
      car.head.rotation.y = this.headYaw;
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, -Math.PI / 2, 0);
    } else {
      if (this.camera.parent !== this.scene) this.scene.add(this.camera);
      const back = 8.5;
      const cx = state.x - Math.cos(state.heading) * back;
      const cy = state.y - Math.sin(state.heading) * back;
      this.camera.position.set(cx, 3.6, -cy);
      this.camera.lookAt(state.x + Math.cos(state.heading) * 6, 1, -(state.y + Math.sin(state.heading) * 6));
    }

    // --- Mirrors (every second frame is plenty)
    const mirrors = driver && this.mirrorsOn;
    if (mirrors && this._frame++ % 2 === 0) {
      car.exterior.visible = false;
      car.interior.visible = false;
      for (const m of Object.values(this.mirrors)) {
        r.setRenderTarget(m.target);
        r.render(this.scene, m.cam);
      }
      r.setRenderTarget(null);
    }

    car.exterior.visible = !driver;
    car.interior.visible = driver;
    r.render(this.scene, this.camera);

    if (mirrors) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.overlay, this.overlayCam);
      r.autoClear = true;
    }
  }
}
