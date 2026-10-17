/**
 * Weekly "missing films" report.
 *
 * For each language: TMDB's most popular films that opened in Indian cinemas
 * 30-150 days ago, checked against the LIVE feed. A film with no platform in
 * the feed is listed, with what TMDB/JustWatch itself says about it:
 *
 *   TMDB has a streaming platform  -> our feed should have it; this is a bug
 *   TMDB has rent/buy only         -> not on a subscription service yet
 *   TMDB has nothing               -> genuinely unknown (aha/SonyLIV lag TMDB)
 *
 * Output: reports/missing-films.md and .json, and the Actions job summary.
 *
 *   node missing-films.mjs [--local] [--per 40] [--from 150 --to 30]
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { rawCall } from './src/tmdb.js';
import { LANGUAGES } from './src/snapshot.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};
const PER = arg('per', 40);
const FROM = arg('from', 150);
const TO = arg('to', 30);
const BASE = 'https://bandirsr.github.io/india-ott-feed';
const LOCAL = process.argv.includes('--local');

const day = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);

async function loadFeed(code) {
  if (LOCAL) return JSON.parse(readFileSync(`public/v1/${code}.json`, 'utf8'));
  const r = await fetch(`${BASE}/v1/${code}.json`);
  if (!r.ok) throw new Error(`${code}: ${r.status}`);
  return r.json();
}

// Any language file counts: a Tamil film dubbed into Telugu is in te.json, and
// a film on a platform is not "missing" because it sits under another language.
const inFeed = new Set();
for (const l of LANGUAGES) {
  const feed = await loadFeed(l.code);
  for (const t of feed.titles) if (t.p?.length) inFeed.add(t.id);
}

async function discover(code) {
  const films = [];
  for (let page = 1; films.length < PER && page <= 5; page += 1) {
    const j = await rawCall('/discover/movie', {
      with_original_language: code,
      region: 'IN',
      with_release_type: '2|3',
      'release_date.gte': day(FROM),
      'release_date.lte': day(TO),
      sort_by: 'popularity.desc',
      include_adult: false,
      page,
    });
    films.push(...(j.results ?? []));
    if (page >= j.total_pages) break;
  }
  // Re-releases of old classics carry their original date; they are not new films.
  return films.filter((f) => f.release_date >= day(FROM + 120)).slice(0, PER);
}

async function tmdbSays(id) {
  const j = await rawCall(`/movie/${id}/watch/providers`);
  const r = j.results?.IN;
  if (!r) return { kind: 'nothing', names: [] };
  const names = (l) => (l ?? []).map((p) => p.provider_name);
  const sub = [...names(r.flatrate), ...names(r.free), ...names(r.ads)];
  if (sub.length) return { kind: 'streaming', names: sub };
  const store = [...names(r.rent), ...names(r.buy)];
  return store.length ? { kind: 'store', names: store } : { kind: 'nothing', names: [] };
}

const out = [];
for (const l of LANGUAGES) {
  const films = await discover(l.code);
  const missing = [];
  for (const f of films) {
    if (inFeed.has(`movie:${f.id}`)) continue;
    const says = await tmdbSays(f.id);
    missing.push({
      id: f.id,
      title: f.title,
      released: f.release_date,
      popularity: Math.round(f.popularity),
      tmdb: says.kind,
      tmdbPlatforms: [...new Set(says.names)],
    });
  }
  out.push({ code: l.code, name: l.name, checked: films.length, missing });
  console.log(`${l.name}: ${films.length} checked, ${missing.length} not in feed`);
}

const bug = out.flatMap((l) => l.missing).filter((m) => m.tmdb === 'streaming').length;
const lines = [];
lines.push(`# Missing films - ${day(0)}`);
lines.push('');
lines.push(
  `Films that opened in Indian cinemas ${TO}-${FROM} days ago (top ${PER} by popularity per original language) with no platform in the live feed.`
);
lines.push('');
lines.push('| Language | Checked | In feed | Missing | TMDB says streaming (our bug) | Rent/buy only | Unknown |');
lines.push('|---|---:|---:|---:|---:|---:|---:|');
for (const l of out) {
  const c = (k) => l.missing.filter((m) => m.tmdb === k).length;
  lines.push(
    `| ${l.name} | ${l.checked} | ${l.checked - l.missing.length} | ${l.missing.length} | ${c('streaming')} | ${c('store')} | ${c('nothing')} |`
  );
}
lines.push('');
for (const l of out) {
  if (!l.missing.length) continue;
  lines.push(`## ${l.name}`);
  lines.push('');
  for (const m of l.missing) {
    const note =
      m.tmdb === 'streaming'
        ? `TMDB lists it on ${m.tmdbPlatforms.join(', ')} - should be in the feed`
        : m.tmdb === 'store'
          ? `rent/buy only (${m.tmdbPlatforms.join(', ')})`
          : 'no platform known anywhere';
    lines.push(`- ${m.title} (${m.released}, popularity ${m.popularity}, tmdb ${m.id}) - ${note}`);
  }
  lines.push('');
}
const md = lines.join('\n');

mkdirSync('reports', { recursive: true });
writeFileSync('reports/missing-films.md', md);
writeFileSync('reports/missing-films.json', JSON.stringify({ date: day(0), languages: out }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(`\nWrote reports/missing-films.md  (${bug} films TMDB says stream but the feed lacks)`);
