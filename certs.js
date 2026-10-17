/**
 * India film certificates (CBFC), from TMDB release_dates, cached.
 *
 *   node certs.js          up to 1500 new titles
 *   node certs.js 20000    a big backfill
 *
 * "A" means adults only in India. src/safety.js removes those films from the
 * app. A certificate does not change once given, so each film is asked once;
 * "no certificate on file" is cached too, and re-asked after 60 days because
 * TMDB gains them over time. Newest titles first.
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { rawCall, loadTmdbKey } from './src/tmdb.js';

if (!loadTmdbKey()) {
  console.log('No TMDB_API_KEY -- certificates skipped.');
  process.exit(0);
}
const BUDGET = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 1500);
const PATH = 'data/certifications.json';
const RETRY_DAYS = 60;
const cache = existsSync(PATH) ? JSON.parse(readFileSync(PATH, 'utf8')) : {};
const today = new Date().toISOString().slice(0, 10);
const age = (d) => (Date.parse(today) - Date.parse(d)) / 86400000;

const FEED = 'https://bandirsr.github.io/india-ott-feed/v1';
const rows = new Map();
for (const l of ['te', 'hi', 'ta', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu']) {
  const p = await (await fetch(`${FEED}/${l}.json`)).json();
  for (const t of p.titles) if (t.id.startsWith('movie:') && !rows.has(t.id)) rows.set(t.id, t.d ?? '');
}
const queue = [...rows.entries()]
  .filter(([id]) => !cache[id] || (!cache[id].c && age(cache[id].on) >= RETRY_DAYS))
  .sort((a, b) => String(b[1]).localeCompare(String(a[1])));
console.log(`${rows.size} films, ${queue.length} to check, budget ${BUDGET}.`);

const save = () => {
  writeFileSync(`${PATH}.tmp`, JSON.stringify(cache));
  renameSync(`${PATH}.tmp`, PATH);
};
let spent = 0;
let aCount = 0;
for (const [id] of queue) {
  if (spent >= BUDGET) break;
  try {
    const j = await rawCall(`/movie/${id.slice(6)}/release_dates`);
    const inn = (j.results ?? []).find((x) => x.iso_3166_1 === 'IN');
    const cert = (inn?.release_dates ?? []).map((d) => String(d.certification ?? '').trim()).find(Boolean) ?? null;
    cache[id] = { c: cert, on: today };
    if (cert === 'A') aCount += 1;
    spent += 1;
  } catch {
    spent += 1; // left uncached, retried next run
  }
  if (spent % 200 === 0) save();
}
save();
console.log(`Checked ${spent}; ${aCount} certified A in this batch.`);
