import { getListWikitext, resolveTitle, getExtract } from './src/wikipedia.js';
import { extractAvailability, looksLikeFilm } from './src/extract.js';
import { titlesFromWikitext } from './src/gapfill.js';

const wt = await getListWikitext(2026);
const titles = titlesFromWikitext(wt);
console.log(`${titles.length} candidate titles on the 2026 Telugu list\n`);

const cut30 = new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
const cut90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
let checked = 0, withOtt = 0, last30 = 0, last90 = 0;
const recent = [];

for (const t of titles.slice(0, 110)) {
  try {
    const r = await resolveTitle(t, 2026);
    if (!r) continue;
    const a = await getExtract(r);
    const text = a?.text ?? '';
    if (!text || !looksLikeFilm(text)) continue;
    checked++;
    const rows = extractAvailability(text).filter(x => x.kind === 'ott' && x.date);
    if (rows.length) withOtt++;
    for (const row of rows) {
      if (row.date >= cut30) { last30++; recent.push(`${row.date}  ${r.slice(0,34).padEnd(36)}${row.platform}`); }
      else if (row.date >= cut90) last90++;
    }
  } catch {}
}
console.log(`${checked} real films checked`);
console.log(`${withOtt} have a DATED OTT release in their article`);
console.log(`${last30} landed in the last 31 days`);
console.log(`${last90} more in the 31-90 day window\n`);
for (const r of recent.slice(0, 25)) console.log('  ' + r);
