// Turns "this title is also in <language>" reports from the app into dubs.
//
// A report is only a claim, so nothing changes on one tap: a film+language pair needs
// REPORTS_NEEDED agreeing reports before it is added to data/dubs.json (the file
// publish.js reads). A single report can still be approved by hand by putting the film id
// in data/language-report-approvals.json ({ "movie:123": ["te"] }). Additive only, and
// every addition is written to data/dubs-reported.json with its report count so it can be
// audited or removed. Reports whose filmId is not a TMDB key are ignored.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const NEEDED = Number(process.env.REPORTS_NEEDED ?? 2);
const CODES = new Set(['te', 'ta', 'ml', 'kn', 'hi', 'bn', 'mr', 'pa', 'gu']);
const read = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);

const reports = read('reports/user-reports.json', []).filter((r) => r.kind === 'language' && /^(movie|tv):\d+$/.test(r.filmId ?? ''));
const approvals = read('data/language-report-approvals.json', {});
const dubs = read('data/dubs.json', {});
const audit = read('data/dubs-reported.json', {});

const counts = new Map(); // "filmId|code" -> { n, title }
for (const r of reports) {
  for (const code of String(r.audio ?? '').split(',')) {
    if (!CODES.has(code)) continue;
    const k = `${r.filmId}|${code}`;
    const c = counts.get(k) ?? { n: 0, title: r.title };
    c.n += 1;
    counts.set(k, c);
  }
}
for (const [id, codes] of Object.entries(approvals)) for (const code of codes) {
  const k = `${id}|${code}`;
  const c = counts.get(k) ?? { n: 0, title: id };
  c.n = Math.max(c.n, NEEDED);
  counts.set(k, c);
}

const added = [];
const waiting = [];
for (const [k, { n, title }] of counts) {
  const [id, code] = k.split('|');
  if (n < NEEDED) { waiting.push(`${title} (${id}) +${code}: ${n}/${NEEDED}`); continue; }
  if ((dubs[id] ?? []).includes(code)) continue;
  dubs[id] = [...(dubs[id] ?? []), code];
  audit[id] = { ...(audit[id] ?? {}), [code]: n };
  added.push(`${title} (${id}) +${code} from ${n} reports`);
}
if (!existsSync('data/dubs-reported.json')) writeFileSync('data/dubs-reported.json', '{}');
if (added.length) { writeFileSync('data/dubs.json', JSON.stringify(dubs)); writeFileSync('data/dubs-reported.json', JSON.stringify(audit, null, 1) + '\n'); }

mkdirSync('reports', { recursive: true });
const md = [`# Language reports - ${new Date().toISOString().slice(0, 10)}`, '', `${reports.length} "also in another language" reports; ${NEEDED} agreeing reports add a language.`, '',
  '## Added this run', ...(added.length ? added.map((x) => `- ${x}`) : ['- none']), '', '## Waiting for more reports', ...(waiting.length ? waiting.map((x) => `- ${x}`) : ['- none'])].join('\n');
writeFileSync('reports/language-reports.md', md + '\n');
console.log(md);
