/**
 * Vets what people reported through the app before anything is added.
 *
 * A report is only a claim. For each one this:
 *   1. looks the title up on TMDB (adult titles excluded) and requires an
 *      Indian-language film or series with a matching name;
 *   2. cross-checks Wikipedia for a page about it;
 *   3. reads its India certificate, description and where it streams in India;
 *   4. runs the SAME safety rules as the publish step (src/safety.js): adult
 *      platforms, explicit words, certificate A with sexual terms, child safety;
 *   5. says whether it is already in the live feed.
 *
 * Verdicts: REJECT (unsafe or not real), ALREADY LISTED, READY TO ADD (real, safe,
 * streams in India, not in the feed: a human adds it to data/manual-releases.json),
 * NEEDS REVIEW (could not be confirmed). It never adds anything by itself.
 *
 *   node vet-reports.mjs
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { rawCall, loadTmdbKey } from './src/tmdb.js';
import { blockReason, childRisk } from './src/safety.js';

if (!loadTmdbKey()) {
  console.log('No TMDB_API_KEY -- vetting skipped.');
  process.exit(0);
}
if (!existsSync('reports/user-reports.json')) {
  console.log('No reports/user-reports.json -- nothing to vet.');
  process.exit(0);
}
const reports = JSON.parse(readFileSync('reports/user-reports.json', 'utf8')).filter((r) => r.kind !== 'other');
const read = (f) => (existsSync(`data/${f}`) ? JSON.parse(readFileSync(`data/${f}`, 'utf8')) : {});
const rules = { certs: read('certifications.json'), manual: read('blocked-titles.json') };

const LANGS = ['te', 'hi', 'ta', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu'];
const LANG_CODE = { telugu: 'te', hindi: 'hi', tamil: 'ta', malayalam: 'ml', kannada: 'kn', bengali: 'bn', marathi: 'mr', punjabi: 'pa', gujarati: 'gu' };
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const inFeed = new Set();
for (const l of LANGS) {
  const p = await (await fetch(`https://bandirsr.github.io/india-ott-feed/v1/${l}.json`)).json();
  for (const t of p.titles) inFeed.add(t.id);
}

async function tmdbMatch(title, langHint) {
  const want = norm(title);
  for (const kind of ['movie', 'tv']) {
    const j = await rawCall(`/search/${kind}`, { query: title, include_adult: false });
    const hit = (j.results ?? []).find((r) => {
      const names = [r.title, r.name, r.original_title, r.original_name].map(norm);
      const lang = LANGS.includes(r.original_language);
      return lang && names.includes(want) && (!langHint || r.original_language === langHint);
    });
    if (hit) return { kind, hit };
  }
  return null;
}

async function wikipediaHas(title) {
  try {
    const u = new URL('https://en.wikipedia.org/w/api.php');
    u.search = new URLSearchParams({ action: 'opensearch', search: `${title} film`, limit: '5', format: 'json' });
    const j = await (await fetch(u, { headers: { 'user-agent': 'OTTwalaVetting/1.0 (bandirsr@gmail.com)' } })).json();
    return (j[1] ?? []).some((t) => norm(t).startsWith(norm(title)));
  } catch {
    return null;
  }
}

const out = [];
for (const r of reports) {
  const langHint = LANG_CODE[String(r.language ?? '').toLowerCase()] ?? null;
  const v = { title: r.title, at: r.at, language: r.language || '', platform: r.platform || '', kind: r.kind };
  try {
    // Text typed by a stranger goes through the safety words before anything else.
    if (childRisk(`${r.title} ${r.note ?? ''}`) || blockReason({ id: '', t: r.title, syn: r.note, p: [] }, {}, rules)) {
      Object.assign(v, { verdict: 'REJECT', why: 'the report text itself trips the safety rules' });
      out.push(v);
      continue;
    }
    const m = await tmdbMatch(r.title, langHint);
    if (!m) {
      Object.assign(v, { verdict: 'NEEDS REVIEW', why: 'no matching Indian-language title on TMDB' });
      out.push(v);
      continue;
    }
    const id = `${m.kind}:${m.hit.id}`;
    const full = await rawCall(`/${m.kind}/${m.hit.id}`);
    let cert = null;
    if (m.kind === 'movie') {
      const rd = await rawCall(`/movie/${m.hit.id}/release_dates`);
      cert = ((rd.results ?? []).find((x) => x.iso_3166_1 === 'IN')?.release_dates ?? []).map((d) => String(d.certification ?? '').trim()).find(Boolean) ?? null;
    }
    const wp = await rawCall(`/${m.kind}/${m.hit.id}/watch/providers`);
    const inProv = wp.results?.IN;
    const streams = [...(inProv?.flatrate ?? []), ...(inProv?.free ?? []), ...(inProv?.ads ?? [])].map((p) => p.provider_name);
    const row = { id, t: full.title ?? full.name, syn: String(full.overview ?? '').slice(0, 400), a: full.adult ? 1 : undefined, p: [] };
    const provMap = {};
    const why = blockReason(row, provMap, { certs: { ...rules.certs, [id]: { c: cert } }, manual: rules.manual });
    Object.assign(v, { tmdb: id, matched: row.t, cert, streams: [...new Set(streams)], wikipedia: await wikipediaHas(row.t) });
    if (why) Object.assign(v, { verdict: 'REJECT', why });
    else if (inFeed.has(id)) Object.assign(v, { verdict: 'ALREADY LISTED', why: 'it is in the live feed' });
    else if (streams.length === 0) Object.assign(v, { verdict: 'NEEDS REVIEW', why: 'real and safe, but TMDB shows no India streaming platform yet' });
    else Object.assign(v, { verdict: 'READY TO ADD', why: `real, safe, streams on ${[...new Set(streams)].join(', ')}, not in the feed` });
  } catch (e) {
    Object.assign(v, { verdict: 'NEEDS REVIEW', why: `lookup failed: ${e.message.slice(0, 80)}` });
  }
  out.push(v);
}

const md = [`# Vetted user reports - ${new Date().toISOString().slice(0, 10)}`, '', '| Title | Verdict | Why | TMDB | Cert | Wikipedia |', '|---|---|---|---|---|---|'];
for (const v of out) md.push(`| ${v.title} | ${v.verdict} | ${v.why} | ${v.tmdb ?? ''} | ${v.cert ?? ''} | ${v.wikipedia === null ? '?' : v.wikipedia ? 'yes' : 'no'} |`);
mkdirSync('reports', { recursive: true });
writeFileSync('reports/user-reports-vetted.md', md.join('\n') + '\n');
writeFileSync('reports/user-reports-vetted.json', JSON.stringify(out, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n', { flag: 'a' });
const tally = {};
for (const v of out) tally[v.verdict] = (tally[v.verdict] ?? 0) + 1;
console.log(out.length, 'reports vetted', tally);
