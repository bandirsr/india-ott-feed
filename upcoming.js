/**
 * "Coming soon": films that are out or about to be out in Indian cinemas but
 * have NO streaming platform in the feed yet. Published as v1/upcoming.json,
 * which the app shows under its "Coming soon" tab. A person who hearts one is
 * notified by the normal arrival check when it first reaches a platform.
 *
 * Source: TMDB discover (theatrical / premiere releases in India, original
 * language = one of ours, adult excluded), minus everything the feed already
 * lists with a platform. Every title passes the same safety rules as the feed
 * (src/safety.js: adult flag, explicit and child-safety terms, certificate A
 * with sexual terms or no description, the hand list).
 *
 *   node upcoming.js        run after publish.js, before verify-published.js
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { rawCall, loadTmdbKey } from './src/tmdb.js';
import { blockReason } from './src/safety.js';
import { LANGUAGES } from './src/snapshot.js';

if (!loadTmdbKey()) {
  console.log('No TMDB_API_KEY -- upcoming list skipped.');
  process.exit(0);
}

const PER_LANGUAGE = 60;
const PAST_DAYS = 120; // already in cinemas, OTT date not known
const FUTURE_DAYS = 90;
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const read = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);

const manifest = read('public/manifest.json', null);
if (!manifest) {
  console.log('No public/manifest.json -- run publish.js first.');
  process.exit(0);
}

// Everything already listed with a platform, in any language.
const listed = new Set();
for (const l of LANGUAGES) {
  const p = read(`public/v1/${l.code}.json`, { titles: [] });
  for (const t of p.titles) if (t.p?.length) listed.add(t.id);
}

const cache = read('data/upcoming-cache.json', {});
const rules = { certs: read('data/certifications.json', {}), manual: read('data/blocked-titles.json', {}) };

async function discover(code) {
  const films = [];
  for (let page = 1; films.length < PER_LANGUAGE && page <= 4; page += 1) {
    const j = await rawCall('/discover/movie', {
      with_original_language: code,
      region: 'IN',
      with_release_type: '2|3',
      'release_date.gte': day(-PAST_DAYS),
      'release_date.lte': day(FUTURE_DAYS),
      sort_by: 'popularity.desc',
      include_adult: false,
      page,
    });
    films.push(...(j.results ?? []));
    if (page >= j.total_pages) break;
  }
  return films;
}

async function facts(id) {
  const key = `movie:${id}`;
  const hit = cache[key];
  if (hit && Date.now() - Date.parse(hit.on) < 14 * 86400000) return hit;
  const full = await rawCall(`/movie/${id}`);
  const rd = await rawCall(`/movie/${id}/release_dates`);
  const cert = ((rd.results ?? []).find((x) => x.iso_3166_1 === 'IN')?.release_dates ?? []).map((d) => String(d.certification ?? '').trim()).find(Boolean) ?? null;
  const out = { syn: String(full.overview ?? '').trim().slice(0, 300), a: full.adult ? 1 : 0, cert, on: new Date().toISOString().slice(0, 10) };
  cache[key] = out;
  return out;
}

const rows = [];
const dropped = [];
const seen = new Set();
for (const lang of LANGUAGES) {
  let kept = 0;
  for (const f of await discover(lang.code)) {
    const id = `movie:${f.id}`;
    if (listed.has(id) || seen.has(id)) continue;
    if (!f.release_date || f.release_date < day(-(PAST_DAYS + 120))) continue; // old re-releases
    const x = await facts(f.id);
    const row = { id, t: f.title, syn: x.syn, a: x.a || undefined, p: [] };
    const why = blockReason(row, {}, { certs: { ...rules.certs, [id]: { c: x.cert } }, manual: rules.manual });
    if (why) {
      dropped.push(`${f.title} (${lang.code}): ${why}`);
      continue;
    }
    seen.add(id);
    kept += 1;
    rows.push({ id, t: f.title, d: f.release_date, i: f.poster_path ?? null, l: lang.code, ...(x.syn ? { syn: x.syn } : {}) });
  }
  console.log(`${lang.name}: ${kept} coming-soon titles`);
}

for (const d of dropped) console.log(`  SAFETY dropped ${d}`);
writeFileSync('data/upcoming-cache.json.tmp', JSON.stringify(cache));
renameSync('data/upcoming-cache.json.tmp', 'data/upcoming-cache.json');

rows.sort((a, b) => (a.d < b.d ? 1 : -1));
const payload = { buildId: manifest.buildId, generatedAt: new Date().toISOString(), titles: rows };
writeFileSync('public/v1/upcoming.json', JSON.stringify(payload));
manifest.upcoming = { path: 'v1/upcoming.json', titles: rows.length };
writeFileSync('public/manifest.json', JSON.stringify(manifest));
console.log(`Wrote v1/upcoming.json: ${rows.length} titles, ${dropped.length} dropped by safety.`);
