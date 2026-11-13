// End-to-end check in a real (headless) browser: loads the app, drives with
// the keyboard, ends the session and saves screenshots.
//   node tools/browser-test.mjs [url] [outDir]
// Needs Chrome: set CHROME_PATH if it is not at /usr/bin/google-chrome.

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:8080/?demo';
const out = process.argv[3] || '/tmp/carsim-shots';
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1440,960'],
  defaultViewport: { width: 1440, height: 960 },
});
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.carsim && window.carsim.state === 'menu', { timeout: 90000 });
console.log('map status:', await page.$eval('#mapStatus', (e) => e.textContent));
await shot('1-menu');

await page.click('#startBtn');
await sleep(1500);
await shot('2-start');

// Drive: accelerate, signal and steer a little, look left, outside camera.
await page.keyboard.down('KeyW');
await sleep(5000);
await shot('3-driving');
await page.keyboard.press('KeyE');
await page.keyboard.down('KeyD');
await sleep(900);
await page.keyboard.up('KeyD');
await sleep(1500);
await shot('4-steered');
await page.keyboard.up('KeyW');
await page.keyboard.down('KeyZ');
await sleep(700);
await shot('5-look-left');
await page.keyboard.up('KeyZ');
await page.keyboard.press('KeyC');
await sleep(600);
await shot('6-outside');
await page.keyboard.press('KeyC');
await page.keyboard.down('Space');
await sleep(2500);
await page.keyboard.up('Space');

const info = await page.evaluate(() => {
  const s = window.carsim.sim;
  return {
    state: window.carsim.state,
    kmh: Math.round(Math.abs(s.state.v) * 3.6),
    distance: Math.round(s.engine.stats.distance),
    events: s.engine.events.map((e) => e.type),
    road: s.loc && s.loc.road.label,
    fps: Math.round(window.carsim.view.fps),
    scale: window.carsim.view.scale,
  };
});
console.log('after driving:', JSON.stringify(info));

await page.keyboard.press('Enter');
await sleep(800);
await shot('7-report');
console.log('verdict:', await page.$eval('#verdict .badge', (e) => e.textContent));
await page.evaluate(() => document.querySelector('#report .card').scrollTo(0, 99999));
await sleep(300);
await shot('8-report-bottom');

console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors');
await browser.close();
process.exit(problems.some((p) => p.startsWith('pageerror')) ? 1 : 0);
