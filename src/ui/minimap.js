// 2D maps: the small map while driving, and the route map in the report.

const KIND_COLOR = { service: '#59626b', living_street: '#59626b' };

function strokeRoads(g, net, scale, minWidthPx) {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const road of net.roads) {
    g.strokeStyle = KIND_COLOR[road.kind] || '#8a949e';
    g.lineWidth = Math.max(road.width * scale, minWidthPx);
    g.beginPath();
    road.pts.forEach((p, i) => (i ? g.lineTo(p.x, -p.y) : g.moveTo(p.x, -p.y)));
    g.stroke();
  }
}

/** Heading-up map centred on the car. */
export function drawMinimap(canvas, net, x, y, heading, rangeM = 140) {
  const g = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const scale = w / (rangeM * 2);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  g.save();
  g.translate(w / 2, h * 0.62);
  g.rotate(heading - Math.PI / 2); // travel direction points up
  g.scale(scale, scale);
  g.translate(-x, y);
  g.fillStyle = '#2b3138';
  for (const b of net.buildings) {
    const bb = b.bounds;
    if (bb.maxX < x - rangeM * 1.5 || bb.minX > x + rangeM * 1.5 || bb.maxY < y - rangeM * 1.5 || bb.minY > y + rangeM * 1.5) continue;
    g.beginPath();
    b.pts.forEach((p, i) => (i ? g.lineTo(p.x, -p.y) : g.moveTo(p.x, -p.y)));
    g.closePath();
    g.fill();
  }
  strokeRoads(g, net, 1, 1.5 / scale);
  g.restore();
  // the car
  g.fillStyle = '#3d9bff';
  g.beginPath();
  g.moveTo(w / 2, h * 0.62 - 13);
  g.lineTo(w / 2 + 8, h * 0.62 + 9);
  g.lineTo(w / 2 - 8, h * 0.62 + 9);
  g.closePath();
  g.fill();
}

const SEVERITY_COLOR = { alvorlig: '#ff5a4f', middels: '#f2b33d', liten: '#9aa6b2' };

/** North-up map of the driven route with numbered remarks. */
export function drawRouteMap(canvas, net, path, events) {
  const g = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!path.length) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of path) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const pad = 60;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const scale = Math.min(w / (maxX - minX), h / (maxY - minY));
  g.save();
  g.translate(w / 2, h / 2);
  g.scale(scale, scale);
  g.translate(-(minX + maxX) / 2, (minY + maxY) / 2);
  g.fillStyle = '#20262c';
  for (const b of net.buildings) {
    g.beginPath();
    b.pts.forEach((p, i) => (i ? g.lineTo(p.x, -p.y) : g.moveTo(p.x, -p.y)));
    g.closePath();
    g.fill();
  }
  strokeRoads(g, net, 1, 2 / scale);
  g.strokeStyle = '#3d9bff';
  g.lineWidth = 5 / scale;
  g.beginPath();
  path.forEach((p, i) => (i ? g.lineTo(p.x, -p.y) : g.moveTo(p.x, -p.y)));
  g.stroke();
  g.restore();

  const toPx = (p) => ({
    x: w / 2 + (p.x - (minX + maxX) / 2) * scale,
    y: h / 2 - (p.y - (minY + maxY) / 2) * scale,
  });
  g.font = 'bold 22px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const start = toPx(path[0]);
  g.fillStyle = '#35c27a';
  g.beginPath();
  g.arc(start.x, start.y, 11, 0, Math.PI * 2);
  g.fill();
  for (const e of events) {
    const p = toPx(e);
    g.fillStyle = SEVERITY_COLOR[e.severity] || '#9aa6b2';
    g.beginPath();
    g.arc(p.x, p.y, 17, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0d1013';
    g.fillText(String(e.id), p.x, p.y + 1);
  }
}
