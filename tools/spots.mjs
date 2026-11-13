import puppeteer from 'puppeteer-core';
const url = process.argv[2]; const out = process.argv[3]; const spots = JSON.parse(process.argv[4]);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
const problems = [];
page.on('console', m => { if (m.type()==='error'||m.type()==='warning') problems.push(m.type()+': '+m.text()); });
page.on('pageerror', e => problems.push('pageerror: '+e.message));
page.on('response', r => { if (r.status()>=400) problems.push('HTTP '+r.status()+' '+r.url()); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.carsim && window.carsim.state === 'menu', { timeout: 90000 });
await page.click('#startBtn');
await new Promise(r => setTimeout(r, 800));
for (const s of spots) {
  await page.evaluate((s) => { const st = window.carsim.sim.state; const h = s.h*Math.PI/180; st.x = s.x - Math.cos(h)*1.445; st.y = s.y - Math.sin(h)*1.445; st.heading = h; st.v = 0; window.carsim.view.mode = s.mode || 'driver'; if (s.blink) window.carsim.sim.blinker = s.blink; }, s);
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: `${out}/${s.name}.png` });
}
console.log(problems.length ? problems.join('\n') : 'no problems');
await browser.close();
