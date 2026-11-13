// Fetches map data for a training area. Tries, in order:
//   1. a snapshot shipped with the app (data/<area>.osm.json or embedded),
//   2. the copy saved in this browser from last time,
//   3. the public OpenStreetMap "Overpass" servers,
//   4. the built-in practice area.
// Map data: (c) OpenStreetMap contributors, ODbL.

import { DEG } from '../geo.js';
import { makeDemoOsm } from './demo-area.js';

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const CACHE_VERSION = 1;

function cacheKey(area) {
  return `carsim.osm.v${CACHE_VERSION}.${area.id}`;
}

function bbox(area) {
  const dLat = area.halfSizeM / 111320;
  const dLon = area.halfSizeM / (111320 * Math.cos(area.lat * DEG));
  return [area.lat - dLat, area.lon - dLon, area.lat + dLat, area.lon + dLon].map((v) => v.toFixed(6)).join(',');
}

export function overpassQuery(area) {
  const b = bbox(area);
  return `[out:json][timeout:40];
(
  way["highway"](${b});
  way["building"](${b});
  node["highway"~"^(crossing|traffic_signals|give_way|stop)$"](${b});
  node["natural"="tree"](${b});
);
out body;
>;
out skel qt;`;
}

function looksValid(osm) {
  if (!osm || !Array.isArray(osm.elements)) return false;
  let ways = 0;
  for (const el of osm.elements) if (el.type === 'way' && el.tags && el.tags.highway) ways++;
  return ways >= 5;
}

async function fetchJson(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {{ osm: object, source: 'pakket'|'lagret'|'hentet'|'øvingsbane', note: string }}
 */
export async function loadAreaData(area, onStatus = () => {}) {
  // 1. Snapshot embedded in the single-file build, or shipped next to the app.
  const embedded = globalThis.__CARSIM_DATA__ && globalThis.__CARSIM_DATA__[area.id];
  if (looksValid(embedded)) return { osm: embedded, source: 'pakket', note: '' };
  if (typeof location !== 'undefined' && location.protocol.startsWith('http')) {
    try {
      const osm = await fetchJson(`data/${area.id}.osm.json`, {}, 8000);
      if (looksValid(osm)) return { osm, source: 'pakket', note: '' };
    } catch {
      /* no snapshot shipped: fine */
    }
  }

  // 2. Saved in this browser.
  try {
    const raw = localStorage.getItem(cacheKey(area));
    if (raw) {
      const osm = JSON.parse(raw);
      if (looksValid(osm)) return { osm, source: 'lagret', note: '' };
    }
  } catch {
    /* storage unavailable or corrupt: fetch again */
  }

  // 3. Fetch from OpenStreetMap.
  const body = 'data=' + encodeURIComponent(overpassQuery(area));
  const errors = [];
  for (const server of OVERPASS_SERVERS) {
    const host = new URL(server).host;
    onStatus(`Henter kart fra ${host} …`);
    try {
      const osm = await fetchJson(
        server,
        { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        45000,
      );
      if (!looksValid(osm)) throw new Error('tomt svar');
      try {
        localStorage.setItem(cacheKey(area), JSON.stringify(osm));
      } catch {
        /* too big for storage: we simply fetch again next time */
      }
      return { osm, source: 'hentet', note: '' };
    } catch (err) {
      errors.push(`${host}: ${err.name === 'AbortError' ? 'tidsavbrudd' : err.message}`);
    }
  }

  // 4. Fall back to the practice area.
  return {
    osm: makeDemoOsm(area),
    source: 'øvingsbane',
    note: `Fikk ikke hentet kartet for ${area.name} (${errors.join('; ')}). Viser en enkel øvingsbane i stedet.`,
  };
}

export function clearSavedMap(area) {
  try {
    localStorage.removeItem(cacheKey(area));
  } catch {
    /* ignore */
  }
}
