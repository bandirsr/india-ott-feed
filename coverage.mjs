/**
 * Coverage matrix for the published feed.
 *
 * Reads the LIVE feed rather than the working copy, because the live one is
 * what the app serves and therefore the only figure worth tracking.
 *
 *   node coverage.mjs [--local] [--json]
 */
const BASE = process.argv.includes('--local')
  ? null
  : 'https://bandirsr.github.io/india-ott-feed';

async function load(path) {
  if (BASE) {
    const r = await fetch(`${BASE}/${path}`);
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  const { readFileSync } = await import('node:fs');
  return JSON.parse(readFileSync(`public/${path}`, 'utf8'));
}

const manifest = await load('manifest.json');
const rows = [];
const providerTally = new Map();
let allTitles = 0;

for (const lang of manifest.languages) {
  const p = await load(lang.path);
  const t = p.titles;
  const n = t.length;
  allTitles += n;

  const has = (fn) => t.filter(fn).length;
  const providers = new Set();
  for (const x of t) {
    for (const e of x.p) {
      const name = p.providers[String(e.id)]?.name;
      if (name) {
        providers.add(name);
        providerTally.set(name, (providerTally.get(name) ?? 0) + 1);
      }
    }
  }

  rows.push({
    code: p.languageCode ?? lang.code,
    name: p.languageName ?? lang.code,
    titles: n,
    poster: has((x) => x.i),
    trailer: has((x) => x.y),
    director: has((x) => x.dir),
    cast: has((x) => x.cast && x.cast.length > 0),
    synopsis: has((x) => x.syn),
    runtime: has((x) => x.run),
    rating: has((x) => x.rate),
    dated: has((x) => x.p.some((e) => e.on)),
    dubbed: has((x) => x.ol),
    series: has((x) => x.k === 'tv'),
    platforms: providers.size,
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ version: manifest.version, allTitles, rows,
    providers: [...providerTally.entries()].sort((a, b) => b[1] - a[1]) }, null, 1));
} else {
  const pct = (a, b) => (b === 0 ? '—' : `${Math.round((a / b) * 100)}%`);
  console.log(`\nFeed ${manifest.version} · ${allTitles} titles · tracking since ${manifest.trackingSince}\n`);
  console.log('  language    titles  poster trailer   dir   cast   syn   run  rate  dated  dubbed  series  plats');
  for (const r of rows) {
    console.log(
      '  ' + r.name.padEnd(12) +
      String(r.titles).padStart(5) +
      pct(r.poster, r.titles).padStart(8) +
      pct(r.trailer, r.titles).padStart(8) +
      pct(r.director, r.titles).padStart(6) +
      pct(r.cast, r.titles).padStart(7) +
      pct(r.synopsis, r.titles).padStart(6) +
      pct(r.runtime, r.titles).padStart(6) +
      pct(r.rating, r.titles).padStart(6) +
      pct(r.dated, r.titles).padStart(7) +
      String(r.dubbed).padStart(8) +
      String(r.series).padStart(8) +
      String(r.platforms).padStart(7)
    );
  }
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  console.log('  ' + 'TOTAL'.padEnd(12) + String(allTitles).padStart(5) +
    pct(sum('poster'), allTitles).padStart(8) + pct(sum('trailer'), allTitles).padStart(8) +
    pct(sum('director'), allTitles).padStart(6) + pct(sum('cast'), allTitles).padStart(7) +
    pct(sum('synopsis'), allTitles).padStart(6) + pct(sum('runtime'), allTitles).padStart(6) +
    pct(sum('rating'), allTitles).padStart(6) + pct(sum('dated'), allTitles).padStart(7) +
    String(sum('dubbed')).padStart(8) + String(sum('series')).padStart(8) +
    String(providerTally.size).padStart(7));
  console.log(`\n  ${providerTally.size} platforms carry at least one title. Top 12 by rows:`);
  for (const [n, c] of [...providerTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log('    ' + String(c).padStart(5) + '  ' + n);
  }
}
