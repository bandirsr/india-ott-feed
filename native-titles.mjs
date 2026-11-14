/**
 * One-time (then incremental) build of data/native-titles.json: each film's name written in the
 * script of the language people read it in (Telugu script for the Telugu list, and so on).
 *
 *   node native-titles.mjs            fill what is missing, keep what is there
 *   node native-titles.mjs --report   only print coverage
 *
 * Sources, best first (the file keeps the source so a wrong one can be traced):
 *   1. "manual"   -- data/native-titles-manual.json, typed or confirmed by a person (always wins)
 *   2. "tmdb"     -- TMDB's own translation in that language, or the original title when the film was
 *                    made in that language
 *   3. "wikidata" -- the film's label in that language, found through its IMDb id
 * A name is only accepted when it is written in the right script, so a Telugu list can never get
 * Malayalam letters (TMDB sometimes returns another language's title).
 *
 * Output: { "te": { "movie:1389379": { "n": "రణబాలి", "s": "tmdb" } }, ... }
 */
import fs from 'node:fs';

const OUT = 'data/native-titles.json';
const MANUAL = 'data/native-titles-manual.json';
const FEED = 'https://bandirsr.github.io/india-ott-feed/v1';
const SCRIPT = {
  hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, te: /[ఀ-౿]/, ta: /[஀-௿]/,
  ml: /[ഀ-ൿ]/, kn: /[ಀ-೿]/, bn: /[ঀ-৿]/, pa: /[਀-੿]/, gu: /[઀-૿]/,
};
const OTHER = /[ऀ-ॿఀ-౿஀-௿ഀ-ൿಀ-೿ঀ-৿਀-੿઀-૿]/;

const key = process.env.TMDB_API_KEY?.trim() || (() => {
  const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('TMDB_API_KEY'));
  return line.split('=')[1].trim();
})();
const bearer = key.length > 60;
async function tmdb(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://api.themoviedb.org/3${path}${bearer ? '' : `${sep}api_key=${key}`}`;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, bearer ? { headers: { Authorization: `Bearer ${key}` } } : {});
      if (r.status === 429) { await new Promise((s) => setTimeout(s, 1500)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await new Promise((s) => setTimeout(s, 800)); }
  }
  return null;
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } }));
}
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const goodFor = (l, s) => !!s && SCRIPT[l].test(s) && !(OTHER.test(s) && [...s].some((c) => OTHER.test(c) && !SCRIPT[l].test(c)));

const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const manual = fs.existsSync(MANUAL) ? JSON.parse(fs.readFileSync(MANUAL, 'utf8')) : {};
const reportOnly = process.argv.includes('--report');
const mergeOnly = process.argv.includes('--merge'); // only fold in the manual file, no lookups

const feeds = {};
for (const l of Object.keys(SCRIPT)) {
  const d = await (await fetch(`${FEED}/${l}.json`)).json();
  feeds[l] = d.titles.filter((t) => /^(movie|tv):\d+$/.test(String(t.id)));
}

if (!reportOnly && !mergeOnly) {
  const cache = new Map(); // id -> {tr:{lang:title}, orig, ol, imdb}
  const need = new Set();
  for (const l in feeds) for (const t of feeds[l]) if (!out[l]?.[t.id]) need.add(t.id);
  console.log('films needing a native name lookup:', need.size);
  let done = 0;
  await pool([...need], 40, async (id) => {
    const [kind, n] = id.split(':');
    const j = await tmdb(`/${kind}/${n}/translations`);
    const d = await tmdb(`/${kind}/${n}`);
    const tr = {};
    for (const x of j?.translations ?? []) tr[x.iso_639_1] = clean(x.data?.title || x.data?.name);
    cache.set(id, { tr, orig: clean(d?.original_title || d?.original_name), ol: d?.original_language });
    if (++done % 500 === 0) console.log(' ', done, '/', need.size);
  });
  for (const l in feeds) {
    out[l] ??= {};
    for (const t of feeds[l]) {
      if (out[l][t.id]) continue;
      const c = cache.get(t.id);
      if (!c) continue;
      if (goodFor(l, c.tr[l])) out[l][t.id] = { n: c.tr[l], s: 'tmdb' };
      else if (c.ol === l && goodFor(l, c.orig)) out[l][t.id] = { n: c.orig, s: 'tmdb' };
    }
  }
  // Wikidata for the gaps, through the IMDb id.
  const gaps = [];
  for (const l in feeds) for (const t of feeds[l]) if (!out[l][t.id]) gaps.push([l, t.id]);
  console.log('gaps after TMDB:', gaps.length);
  const imdb = new Map();
  const ids = [...new Set(gaps.map((g) => g[1]))];
  await pool(ids, 40, async (id) => {
    const [kind, n] = id.split(':');
    const j = await tmdb(`/${kind}/${n}/external_ids`);
    if (j?.imdb_id) imdb.set(id, j.imdb_id);
  });
  const byImdb = new Map(); // imdb -> {lang: label}
  const list = [...new Set(imdb.values())];
  for (let i = 0; i < list.length; i += 120) {
    const batch = list.slice(i, i + 120);
    const q = `SELECT ?i ?l ?lab WHERE { VALUES ?i { ${batch.map((x) => `"${x}"`).join(' ')} } ?it wdt:P345 ?i . ?it rdfs:label ?lab . BIND(LANG(?lab) AS ?l) FILTER(?l IN (${Object.keys(SCRIPT).map((x) => `"${x}"`).join(',')})) }`;
    try {
      const r = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/sparql-results+json', 'user-agent': 'native-titles/1.0' },
        body: 'query=' + encodeURIComponent(q),
      });
      const j = await r.json();
      for (const b of j.results.bindings) {
        const m = byImdb.get(b.i.value) ?? {};
        m[b.l.value] = clean(b.lab.value);
        byImdb.set(b.i.value, m);
      }
    } catch (e) { console.log('wikidata batch failed', e.message); }
    await new Promise((s) => setTimeout(s, 400));
  }
  for (const [l, id] of gaps) {
    const lab = byImdb.get(imdb.get(id))?.[l];
    if (goodFor(l, lab)) out[l][id] = { n: lab, s: 'wikidata' };
  }
}
// Manual entries always win.
for (const l in manual) for (const id in manual[l]) { out[l] ??= {}; out[l][id] = { n: manual[l][id], s: 'manual' }; }

if (!reportOnly) fs.writeFileSync(OUT, JSON.stringify(out));
console.log('\nlanguage   have / films   (tmdb, wikidata, manual)');
for (const l in feeds) {
  const m = out[l] ?? {};
  const own = feeds[l].filter((t) => m[t.id]);
  const by = (s) => own.filter((t) => m[t.id].s === s).length;
  console.log(l.padEnd(6), `${own.length} / ${feeds[l].length}`.padEnd(14), `(${by('tmdb')}, ${by('wikidata')}, ${by('manual')})`);
}
