// Small textures drawn in code, so the app needs no image files.

import * as THREE from 'three';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const speedCache = new Map();

/** Norwegian speed limit sign (sign 362): white disc, red ring, black number. */
export function speedSignTexture(value) {
  if (speedCache.has(value)) return speedCache.get(value);
  const c = canvas(256);
  drawSpeedSign(c.getContext('2d'), 128, 128, 126, value);
  const t = toTexture(c);
  speedCache.set(value, t);
  return t;
}

export function drawSpeedSign(g, cx, cy, r, value) {
  g.fillStyle = '#c8102e';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx, cy, r * 0.76, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111111';
  const text = String(value);
  g.font = `bold ${Math.round(r * (text.length > 2 ? 0.78 : 0.98))}px Arial, Helvetica, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, cx, cy + r * 0.05);
}

let crossingTex = null;

/** Pedestrian crossing sign (sign 516): blue square, white triangle, walking figure. */
export function crossingSignTexture() {
  if (crossingTex) return crossingTex;
  const c = canvas(256);
  const g = c.getContext('2d');
  g.fillStyle = '#0b5cad';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(128, 28);
  g.lineTo(232, 222);
  g.lineTo(24, 222);
  g.closePath();
  g.fill();
  // simple walking figure
  g.strokeStyle = '#111';
  g.fillStyle = '#111';
  g.lineWidth = 12;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(134, 96, 12, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(132, 114);
  g.lineTo(124, 160); // body
  g.moveTo(124, 160);
  g.lineTo(100, 200); // back leg
  g.moveTo(124, 160);
  g.lineTo(150, 198); // front leg
  g.moveTo(130, 124);
  g.lineTo(104, 146); // back arm
  g.moveTo(130, 124);
  g.lineTo(158, 142); // front arm
  g.stroke();
  // crossing stripes
  g.lineWidth = 8;
  g.beginPath();
  for (let x = 70; x <= 190; x += 30) {
    g.moveTo(x, 212);
    g.lineTo(x + 14, 212);
  }
  g.stroke();
  crossingTex = toTexture(c);
  return crossingTex;
}

let windowTex = null;

/** One window on a white wall; tiled across facades and tinted by the wall colour. */
export function windowTexture() {
  if (windowTex) return windowTex;
  const c = canvas(64);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#e4e4e0';
  g.fillRect(17, 15, 30, 34); // frame
  g.fillStyle = '#44566a';
  g.fillRect(19, 17, 26, 30); // glass
  g.fillStyle = '#5d7389';
  g.fillRect(19, 17, 26, 9); // sky reflection
  g.fillStyle = '#e4e4e0';
  g.fillRect(31, 17, 2, 30); // mullion
  windowTex = toTexture(c, true);
  return windowTex;
}
