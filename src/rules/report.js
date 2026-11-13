// Turns the instructor's notes into a report with a verdict. Pure logic.
//
// The verdict is indicative only. It is NOT Statens vegvesen's assessment,
// and this version checks only part of what a real driving test covers.

import { RULES } from '../config.js';
import { EVENT_TYPES, describeEvent } from './engine.js';

export const NOT_ASSESSED = [
  'vikeplikt og samhandling med andre trafikanter',
  'fotgjengere og syklister',
  'trafikklys',
  'observasjon (speil, blindsone, blikkbruk)',
  'avstand til forankjørende',
  'parkering og rygging',
];

const SEVERITY_ORDER = { alvorlig: 0, middels: 1, liten: 2 };
const SEVERITY_LABEL = { alvorlig: 'Alvorlig', middels: 'Middels', liten: 'Liten' };

export function buildReport(engine, rules = RULES) {
  const st = engine.stats;
  const events = [...engine.events].sort((a, b) => a.t - b.t);
  const count = { alvorlig: 0, middels: 0, liten: 0 };
  for (const e of events) count[e.severity]++;

  // Group by type, most serious first.
  const groups = [];
  for (const type of Object.keys(EVENT_TYPES)) {
    const items = events.filter((e) => e.type === type);
    if (!items.length) continue;
    const worst = items.reduce((w, e) => (SEVERITY_ORDER[e.severity] < SEVERITY_ORDER[w] ? e.severity : w), 'liten');
    groups.push({
      type,
      label: EVENT_TYPES[type].label,
      advice: EVENT_TYPES[type].advice,
      severity: worst,
      severityLabel: SEVERITY_LABEL[worst],
      items: items.map((e) => ({ ...e, text: describeEvent(e), severityLabel: SEVERITY_LABEL[e.severity] })),
    });
  }
  groups.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.items.length - a.items.length);

  const minutes = Math.max(st.duration / 60, 1e-6);
  const points = count.middels * 2 + count.liten;
  const pointsPer10 = (points / minutes) * 10;

  let verdict;
  let title;
  const reasons = [];
  if (st.duration < rules.minSessionS || st.distance < rules.minSessionM) {
    verdict = 'for_kort';
    title = 'For kort økt til å vurdere';
    reasons.push(
      `Økten må vare minst ${Math.round(rules.minSessionS / 60)} minutter og ${rules.minSessionM} meter for å gi en vurdering.`,
    );
  } else if (count.alvorlig > 0) {
    verdict = 'ikke_bestatt';
    title = 'Ikke bestått';
    for (const g of groups.filter((g) => g.severity === 'alvorlig')) {
      const n = g.items.filter((i) => i.severity === 'alvorlig').length;
      reasons.push(`${g.label}${n > 1 ? ` (${n} ganger)` : ''}`);
    }
  } else if (count.middels >= 3) {
    verdict = 'ikke_bestatt';
    title = 'Ikke bestått';
    reasons.push(`${count.middels} middels alvorlige feil. Grensen er 2.`);
  } else if (pointsPer10 > 8) {
    verdict = 'ikke_bestatt';
    title = 'Ikke bestått';
    reasons.push('For mange småfeil til sammen.');
  } else {
    verdict = 'bestatt';
    title = 'Bestått';
    reasons.push(events.length ? 'Ingen alvorlige feil, og få småfeil.' : 'Ingen feil registrert.');
  }

  return {
    verdict,
    title,
    reasons,
    count,
    groups,
    advice: groups.map((g) => g.advice),
    notAssessed: NOT_ASSESSED,
    stats: {
      durationS: st.duration,
      distanceM: st.distance,
      maxKmh: st.maxKmh,
      avgKmh: st.movingTime > 0 ? (st.distance / st.movingTime) * 3.6 : 0,
      speedingShare: st.movingTime > 0 ? st.speedingTime / st.movingTime : 0,
      turns: st.turns,
      turnsSignalled: st.turnsSignalled,
    },
    scoring:
      'Én alvorlig feil gir ikke bestått. Tre eller flere middels feil gir ikke bestått. ' +
      'Ellers gir middels feil 2 poeng og små feil 1 poeng; mer enn 8 poeng per 10 minutter gir ikke bestått.',
  };
}
