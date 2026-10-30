// Daily gap check: weekly OTT roundups that viewers find on Google (Sacnilk) against
// the feed we just built. Report only -- it never edits the feed. Writes data/gaps.json
// listing Indian-language titles the roundups name that no language file contains,
// each already matched to a real TMDB id and poster so a person can add it to
// data/manual-releases.json in one step. Run after publish.js; never fails the sweep.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEY = process.env.TMDB_API_KEY;
const OUT = 'data/gaps.json';
const INDIAN = ['Telugu', 'Tamil', 'Hindi', 'Malayalam', 'Kannada', 'Bengali', 'Marathi', 'Gujarati', 'Punjabi'];
const CODE = { Telugu: 'te', Tamil: 'ta', Hindi: 'hi', Malayalam: 'ml', Kannada: 'kn', Bengali: 'bn', Marathi: 'mr', Gujarati: 'gu', Punjabi: 'pa' };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const norm = (s) => String(s).toLowerCase().replace(/&amp;/g, '&').replace(/\(series\)/g, '').replace(/[^a-z0-9]/g, '');
const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
const get = async (u) => (await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0' } })).text();

// 1. The newest weekly roundups, found on Sacnilk's OTT tag page.
const tag = await get('https://www.sacnilk.com/tag/OTT');
const urls = [...new Set([...tag.matchAll(/https:\/\/www\.sacnilk\.com\/news\/new-ott-releases-this-week-[a-z0-9-]+/g)].map((m) => m[0]))];
const recent = urls.filter((u) => {
  const slug = u.split('/').pop();
  const year = Number(slug.match(/-(20\d\d)-/)?.[1]);
  const months = MONTHS.map((m, i) => (slug.includes(`-${m}-`) || slug.includes(`this-week-${m}-`) ? i : -1)).filter((i) => i >= 0);
  if (!year || months.length === 0) return false;
  const end = new Date(Date.UTC(year, Math.max(...months) + (months.length > 1 && months[0] > months[1] ? 0 : 0), 28));
  return Date.now() - end.getTime() < 40 * 86_400_000;
}).slice(0, 4);

// 2. Titles from each roundup: featured blocks and the schedule table.
const rows = [];
for (const url of recent) {
  const html = await get(url);
  const year = url.match(/-(20\d\d)-/)?.[1] ?? new Date().getFullYear();
  for (const m of html.matchAll(/<h3>\s*\d+\.\s*([^<]+)<\/h3>\s*<p><b>OTT Release:\s*([^<]+)<\/b>[\s\S]*?<b>Platform:<\/b>\s*([^<]*)<[\s\S]*?<b>Language:<\/b>\s*([^<]*)</g)) {
    rows.push({ title: text(m[1]), date: m[2].trim(), platform: text(m[3]), languages: text(m[4]), series: false, url });
  }
  for (const m of html.matchAll(/<tr>\s*<td>([A-Z][a-z]{2} \d{1,2})<\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<\/tr>/g)) {
    rows.push({ title: text(m[2]), date: `${m[1]}, ${year}`, platform: text(m[3]), languages: text(m[4]), series: /\(series\)/i.test(m[2]), url });
  }
}

// 3. What the feed already holds, and what a person already added by hand.
const have = new Set();
for (const c of Object.values(CODE)) {
  // GAP_LIVE=1 reads the published feed instead of the files just built (for testing off the runner).
  const f = `public/v1/${c}.json`;
  const doc = process.env.GAP_LIVE ? await (await fetch(`https://bandirsr.github.io/india-ott-feed/v1/${c}.json`)).json() : existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { titles: [] };
  for (const t of doc.titles) have.add(norm(t.t));
}
const manual = new Set(JSON.parse(readFileSync('data/manual-releases.json', 'utf8')).map((r) => norm(r.title)));

// 4. Indian-language titles nobody has.
const tmdb = async (kind, q) => (await (await fetch(`https://api.themoviedb.org/3/search/${kind}?api_key=${KEY}&query=${encodeURIComponent(q)}`)).json()).results ?? [];
const gaps = [];
const seen = new Set();
for (const r of rows) {
  const langs = r.languages.split(/,|&/).map((s) => s.trim()).filter((l) => INDIAN.includes(l));
  const n = norm(r.title);
  if (!langs.length || have.has(n) || seen.has(n)) continue;
  seen.add(n);
  const kind = r.series ? 'tv' : 'movie';
  const hit = (await tmdb(kind, r.title.replace(/\(Series\)/i, '').trim())).find((x) => Number((x.release_date ?? x.first_air_date ?? '0').slice(0, 4)) >= Number(new Date().getFullYear()) - 1 && (norm(x.title ?? x.name) === n || norm(x.original_title ?? x.original_name ?? '') === n));
  const lang = hit && Object.entries(CODE).find(([, c]) => c === hit.original_language)?.[0];
  if (!hit || !lang) continue; // not an Indian-original title on TMDB (dub-only or foreign)
  gaps.push({
    title: hit.title ?? hit.name, tmdb: `${kind}:${hit.id}`, language: lang, platform: r.platform, date: r.date,
    poster: Boolean(hit.poster_path), series: r.series, alreadyHandAdded: manual.has(n), source: r.url,
  });
}
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), roundups: recent, checked: rows.length, gaps }, null, 2) + '\n');
console.log(`gapcheck: ${rows.length} roundup rows, ${gaps.length} missing from the feed`);
for (const g of gaps) console.log(`  ${g.alreadyHandAdded ? '(hand-added, not yet live)' : 'MISSING'} ${g.title} [${g.language}] ${g.platform} ${g.date} ${g.tmdb}`);
