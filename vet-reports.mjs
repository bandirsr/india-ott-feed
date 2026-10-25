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

const resolutions = read('report-resolutions.json');
const LANGS = ['te', 'hi', 'ta', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu'];
const LANG_CODE = { telugu: 'te', hindi: 'hi', tamil: 'ta', malayalam: 'ml', kannada: 'kn', bengali: 'bn', marathi: 'mr', punjabi: 'pa', gujarati: 'gu' };
// A leading "The" is dropped: people type "Paradise" for "The Paradise".
const norm = (s) => String(s ?? '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');

// id -> { t, lang, soon }: everything the app can show, including the Coming soon list.
const inFeed = new Map();
for (const l of LANGS) {
  const p = await (await fetch(`https://bandirsr.github.io/india-ott-feed/v1/${l}.json`)).json();
  for (const t of p.titles) inFeed.set(t.id, { t: t.t, lang: l, soon: false });
}
const upcoming = await (await fetch('https://bandirsr.github.io/india-ott-feed/v1/upcoming.json')).json();
for (const t of upcoming.titles ?? []) if (!inFeed.has(t.id)) inFeed.set(t.id, { t: t.t, lang: t.l, soon: true });

// Edit distance, for spotting a misspelling of a title the app already has ("Radbali" for "Ranabaali").
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function lookalikes(title) {
  const w = norm(title);
  if (w.length < 5) return [];
  const hits = [];
  for (const [id, f] of inFeed) {
    const n = norm(f.t);
    if (Math.abs(n.length - w.length) > 3) continue;
    const dist = distance(w, n);
    if (dist <= Math.max(2, Math.round(w.length * 0.4)) && dist > 0) hits.push({ id, t: f.t, lang: f.lang, soon: f.soon, dist });
  }
  return hits.sort((a, b) => a.dist - b.dist).slice(0, 3);
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
    // A human-confirmed match (a title typed in Telugu script, or misspelt) beats the name search.
    const res = resolutions[r.title];
    if (res && typeof res === 'object') {
      // {"close": "why"} -> closed with a reason (not a film we list); {"note": "..."} -> stays open with the note.
      Object.assign(v, res.close ? { verdict: 'CLOSED', why: res.close } : { verdict: 'NEEDS REVIEW', why: res.note });
      out.push(v);
      continue;
    }
    const pinned = typeof res === 'string' ? res : null;
    const m = pinned ? { kind: pinned.split(':')[0], hit: { id: pinned.split(':')[1] } } : await tmdbMatch(r.title, langHint);
    if (!m) {
      // Nothing exact: show the closest Indian-language titles so a human can tell a typo from a film TMDB lacks.
      const want = norm(r.title);
      const close = [];
      for (const kind of ['movie', 'tv']) {
        const j = await rawCall(`/search/${kind}`, { query: r.title, include_adult: false });
        for (const x of j.results ?? []) {
          const n = norm(x.title ?? x.name);
          if (LANGS.includes(x.original_language) && want.length >= 3 && (n.includes(want) || want.includes(n))) {
            close.push(`${x.title ?? x.name} (${(x.release_date ?? x.first_air_date ?? '').slice(0, 4)}, ${x.original_language}, ${kind}:${x.id})`);
          }
        }
      }
      const look = lookalikes(r.title).map((h) => `${h.t} (${h.lang}, ${h.id}, ${h.soon ? 'in the app, Coming soon' : 'in the app'})`);
      if (look.length) close.unshift(`looks like a misspelling of: ${look.join('; ')}`);
      Object.assign(v, {
        verdict: 'NEEDS REVIEW',
        why: close.length ? `no exact match; similar: ${close.slice(0, 3).join('; ')}` : 'no matching Indian-language title on TMDB',
      });
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
    else if (inFeed.has(id)) Object.assign(v, { verdict: 'ALREADY LISTED', why: inFeed.get(id).soon ? 'in the app under Coming soon (not streaming yet)' : 'it is in the live feed' });
    else if (streams.length === 0) Object.assign(v, { verdict: 'NEEDS REVIEW', why: 'real and safe, but TMDB shows no India streaming platform yet' });
    else Object.assign(v, { verdict: 'READY TO ADD', why: `real, safe, streams on ${[...new Set(streams)].join(', ')}, not in the feed` });
  } catch (e) {
    Object.assign(v, { verdict: 'NEEDS REVIEW', why: `lookup failed: ${e.message.slice(0, 80)}` });
  }
  out.push(v);
}

// --- ledger: when each report came in, and when it was fixed ----------------------------------
// Kept in reports/user-reports-status.json so a report keeps its dates from one run to the next.
// "listedOn" is the first run on which the checker found the title in the live feed; a report
// that was already covered when it arrived says so (listedOn on the day it was reported).
const nowIso = new Date().toISOString();
const today = nowIso.slice(0, 10);
const ledgerPath = 'reports/user-reports-status.json';
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {};
const isTest = (t) => /(^|[^a-z])(test|testtest|ignore)([^a-z]|$)/i.test(t);
const STATUS = {
  FIXED: { icon: '🟢', label: 'Fixed - in the app' },
  READY: { icon: '🔵', label: 'Ready to add' },
  REVIEW: { icon: '🟡', label: 'Needs a look' },
  CLOSED: { icon: '🟣', label: 'Closed - nothing to add' },
  REJECT: { icon: '🔴', label: 'Rejected by safety rules' },
  TEST: { icon: '⚪', label: 'Test entry' },
};
const rows = [];
for (const v of out) {
  const key = `${v.at}|${v.title}`;
  const prev = ledger[key] ?? {};
  const status = isTest(v.title) ? 'TEST' : v.verdict === 'ALREADY LISTED' ? 'FIXED' : v.verdict === 'CLOSED' ? 'CLOSED' : v.verdict === 'READY TO ADD' ? 'READY' : v.verdict === 'REJECT' ? 'REJECT' : 'REVIEW';
  const row = {
    ...prev,
    key, title: v.title, reportedAt: v.at, language: v.language, appPlatform: reports.find((r) => r.at === v.at && r.title === v.title)?.source ?? '',
    onPlatform: v.platform, note: reports.find((r) => r.at === v.at && r.title === v.title)?.note ?? '',
    status, verdict: v.verdict, why: v.why, tmdb: v.tmdb ?? null, matched: v.matched ?? null, cert: v.cert ?? null,
    firstSeen: prev.firstSeen ?? today, checkedOn: today, firstCheckedAt: prev.firstCheckedAt ?? nowIso, checkedAt: nowIso,
  };
  if (status === 'FIXED' || status === 'CLOSED') {
    row.fixedOn = prev.fixedOn ?? today;
    row.fixedAt = prev.fixedAt ?? nowIso;
  } else {
    delete row.fixedOn;
    delete row.fixedAt;
  }
  ledger[key] = row;
  rows.push(row);
}
writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1));

const day = (iso) => String(iso ?? '').slice(0, 10);
const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, rows.filter((r) => r.status === k).length]));
const order = ['REVIEW', 'READY', 'REJECT', 'FIXED', 'CLOSED', 'TEST'];
const md = [
  `# What people reported - checked ${today}`,
  '',
  Object.keys(STATUS).map((k) => `${STATUS[k].icon} ${STATUS[k].label}: **${counts[k]}**`).join(' &nbsp;·&nbsp; '),
  '',
  'Newest first inside each group. "Fixed on" is the first day the checker saw the title in the live app; a report already covered when it arrived shows the report day.',
];
for (const k of order) {
  const group = rows.filter((r) => r.status === k).sort((a, b) => (a.reportedAt < b.reportedAt ? 1 : -1));
  if (!group.length) continue;
  md.push('', `## ${STATUS[k].icon} ${STATUS[k].label} (${group.length})`, '', '| Reported | Title | Language | From | Their note | What we found | Fixed on |', '|---|---|---|---|---|---|---|');
  for (const r of group) {
    const found = r.matched ? `${r.matched} (${r.tmdb}${r.cert ? ', cert ' + r.cert : ''})` : r.why;
    md.push(`| ${day(r.reportedAt)} | **${r.title}** | ${r.language || '-'} | ${r.appPlatform || '-'}${r.onPlatform ? ' · ' + r.onPlatform : ''} | ${r.note || '-'} | ${k === 'FIXED' ? '' : r.why + (r.matched ? '' : '')}${k === 'FIXED' ? found : ''} | ${r.fixedOn ? (day(r.reportedAt) === r.fixedOn ? r.fixedOn + ' (same day)' : r.fixedOn) : '-'} |`);
  }
}
mkdirSync('reports', { recursive: true });
writeFileSync('reports/user-reports-vetted.md', md.join('\n') + '\n');
writeFileSync('reports/user-reports-vetted.json', JSON.stringify(rows, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n', { flag: 'a' });
const tally = {};
for (const v of out) tally[v.verdict] = (tally[v.verdict] ?? 0) + 1;
console.log(out.length, 'reports vetted', tally);
