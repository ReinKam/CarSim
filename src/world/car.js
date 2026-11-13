// The visible car: a simple exterior (seen from outside) and a simple
// interior (dashboard, steering wheel, roof pillars) seen from the driver's seat.
// Neutral shapes on purpose: the real manufacturer's design is not reproduced.
//
// Car-local axes: origin at the centre of the rear axle on the ground,
// +X forward, +Y up, -Z is the car's left side (driver's side in Norway).

import * as THREE from 'three';
import { maxSteerRad } from '../vehicle/cars.js';

function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

/** A thin bar between two points. */
function bar(a, b, thickness, color) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(thickness, dir.length(), thickness * 1.3),
    new THREE.MeshLambertMaterial({ color }),
  );
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

export function createCarVisual(car) {
  const group = new THREE.Group();
  const front = car.wheelbaseM + car.overhangFrontM;
  const rear = front - car.lengthM;
  const mid = (front + rear) / 2;
  const hw = car.widthM / 2;

  // ---------- Exterior
  const exterior = new THREE.Group();
  exterior.add(box(car.lengthM, 0.72, car.widthM, '#e7eaee', mid, 0.63, 0));
  exterior.add(box(car.lengthM * 0.56, car.heightM - 0.99, car.widthM * 0.86, '#1d2630', mid - 0.25, 0.99 + (car.heightM - 0.99) / 2, 0));
  const wheelGeo = new THREE.CylinderGeometry(car.wheelRadiusM, car.wheelRadiusM, 0.26, 18);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: '#17181a' });
  const frontWheels = [];
  for (const [x, z, steer] of [
    [0, -hw + 0.13, false],
    [0, hw - 0.13, false],
    [car.wheelbaseM, -hw + 0.13, true],
    [car.wheelbaseM, hw - 0.13, true],
  ]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, car.wheelRadiusM, z);
    exterior.add(w);
    if (steer) frontWheels.push(w);
  }
  const brakeMat = new THREE.MeshBasicMaterial({ color: '#5a0d0d' });
  for (const z of [-hw + 0.3, hw - 0.3]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.42), brakeMat);
    l.position.set(rear - 0.01, 0.9, z);
    exterior.add(l);
  }
  const blinkMat = { left: new THREE.MeshBasicMaterial({ color: '#4a3300' }), right: new THREE.MeshBasicMaterial({ color: '#4a3300' }) };
  for (const [side, z] of [
    ['left', -hw + 0.08],
    ['right', hw - 0.08],
  ]) {
    for (const x of [rear - 0.01, front + 0.01]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.16), blinkMat[side]);
      l.position.set(x, 0.78, z);
      exterior.add(l);
    }
  }
  group.add(exterior);

  // ---------- Interior (driver's view)
  const interior = new THREE.Group();
  const eye = new THREE.Vector3(1.42, car.eyeHeightM, -0.37);
  const dark = '#16181b';
  interior.add(box(0.55, 0.3, car.widthM - 0.16, dark, eye.x + 0.78, 0.86, 0)); // dashboard
  const hood = box(front - (eye.x + 1.05), 0.08, car.widthM - 0.04, '#e7eaee', (front + eye.x + 1.05) / 2, 0.93, 0);
  hood.rotation.z = -0.09;
  interior.add(hood);
  // A-pillars and roof edge: they hide part of the view, just like in a real car.
  const pillarBase = eye.x + 0.98;
  const pillarTop = eye.x + 0.3;
  interior.add(bar(new THREE.Vector3(pillarBase, 1.0, -hw + 0.08), new THREE.Vector3(pillarTop, 1.56, -hw + 0.2), 0.075, dark));
  interior.add(bar(new THREE.Vector3(pillarBase, 1.0, hw - 0.08), new THREE.Vector3(pillarTop, 1.56, hw - 0.2), 0.075, dark));
  interior.add(box(0.4, 0.05, car.widthM - 0.3, dark, pillarTop - 0.12, 1.585, 0));
  // door tops
  interior.add(box(1.3, 0.05, 0.06, dark, eye.x + 0.2, 0.98, -hw + 0.07));
  interior.add(box(1.3, 0.05, 0.06, dark, eye.x + 0.2, 0.98, hw - 0.07));

  // Steering wheel: rotates about its own axis (X before tilting).
  const column = new THREE.Group();
  column.position.set(eye.x + 0.43, 1.0, eye.z);
  column.rotation.z = -0.38;
  const wheel = new THREE.Group();
  const rimGeo = new THREE.TorusGeometry(0.185, 0.019, 10, 40);
  rimGeo.rotateY(Math.PI / 2);
  const wheelColor = new THREE.MeshLambertMaterial({ color: '#2a2d31' });
  wheel.add(new THREE.Mesh(rimGeo, wheelColor));
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 0.36), wheelColor);
  wheel.add(spoke);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.17, 0.04), wheelColor);
  lower.position.y = -0.09;
  wheel.add(lower);
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: '#d7dade' }));
  marker.position.y = 0.185;
  wheel.add(marker); // 12 o'clock mark, so wheel rotation is easy to read
  column.add(wheel);
  interior.add(column);
  group.add(interior);

  // ---------- Camera mounts
  const head = new THREE.Object3D(); // turns with the driver's head
  head.position.copy(eye);
  group.add(head);

  const mirrorMounts = {
    rear: mount(rear + 0.35, 1.22, 0, Math.PI / 2),
    left: mount(eye.x + 0.6, 1.06, -hw - 0.1, Math.PI / 2 - 0.16),
    right: mount(eye.x + 0.6, 1.06, hw + 0.1, Math.PI / 2 + 0.16),
  };
  function mount(x, y, z, yaw) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    o.rotation.y = yaw; // a camera placed here looks backwards
    group.add(o);
    return o;
  }

  const steerMax = maxSteerRad(car);
  const lockRad = ((car.lockToLockDeg / 2) * Math.PI) / 180;

  return {
    group,
    exterior,
    interior,
    head,
    mirrorMounts,
    /** Move the car model to match the simulation state. */
    update(state, { brake, blinker, blinkOn }) {
      group.position.set(state.x, 0, -state.y);
      group.rotation.y = state.heading;
      for (const w of frontWheels) w.rotation.y = state.steer;
      wheel.rotation.x = -(state.steer / steerMax) * lockRad;
      brakeMat.color.set(brake > 0.02 ? '#ff2a1f' : '#5a0d0d');
      blinkMat.left.color.set(blinker === 'left' && blinkOn ? '#ffb000' : '#4a3300');
      blinkMat.right.color.set(blinker === 'right' && blinkOn ? '#ffb000' : '#4a3300');
    },
  };
}
