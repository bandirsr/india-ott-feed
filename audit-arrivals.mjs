/**
 * Audit published feeds for arrival dates that look false.
 *
 *   node audit-arrivals.mjs [dir] [prefix]     (default: public/v1, files <lang>.json)
 *
 * Reports, per kind of suspicion, how many provider entries carry a watched
 * arrival that is implausible:
 *   after-digital  arrival > DIGITAL_GAP_DAYS after the film's digital release
 *                  (what publish.js now nulls; non-zero here = guard missing)
 *   no-digital     no digital date known, arrival > 200 days after the cinema
 *                  date: cannot be checked against a digital date, so listed
 *                  for a human look rather than changed
 *   recent-old     arrival in the last 14 days on a film released > 200 days ago
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DIGITAL_GAP_DAYS } from './src/arrival.js';

const dir = process.argv[2] ?? 'public/v1';
const prefix = process.argv[3] ?? '';
const today = new Date().toISOString().slice(0, 10);
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const rows = { 'after-digital': [], 'no-digital': [], 'recent-old': [] };
let pairs = 0, dated = 0;

for (const f of readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith('.json') && !x.startsWith('manifest'))) {
  const payload = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const names = payload.providers ?? {};
  for (const t of payload.titles ?? []) {
    for (const e of t.p ?? []) {
      pairs += 1;
      if (!e.on) continue;
      dated += 1;
      const row = `${t.t} [${f.replace('.json', '')}] ${names[e.id]?.name ?? e.id}: arrived ${e.on}, cinema ${t.d ?? '?'}, digital ${t.dg ?? '-'}`;
      if (t.dg && days(t.dg, e.on) > DIGITAL_GAP_DAYS) rows['after-digital'].push(row);
      else if (!t.dg && t.d && days(t.d, e.on) > 200) rows['no-digital'].push(row);
      if (t.d && days(t.d, e.on) > 200 && days(e.on, today) <= 14) rows['recent-old'].push(row);
    }
  }
}
console.log(`${dir}: ${pairs} provider entries, ${dated} with a watched arrival date`);
for (const [k, v] of Object.entries(rows)) {
  console.log(`\n${k}: ${v.length}`);
  for (const r of [...new Set(v)].slice(0, 12)) console.log('  ' + r);
}
