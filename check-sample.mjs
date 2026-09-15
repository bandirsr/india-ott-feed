/**
 * Check a list of title names against the published feed.
 *
 *   node check-sample.mjs sample.txt
 *
 * Matching is deliberately loose -- lowercased, punctuation and the
 * language-in-brackets suffix stripped -- because the question is "do we know
 * about this film at all", not "does the string match".
 */
import { readFileSync } from 'node:fs';

const norm = (s) =>
  s.toLowerCase()
    .replace(/\((telugu|tamil|hindi|malayalam|kannada|cam|4k)\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
const index = new Map();
for (const lang of manifest.languages) {
  const p = JSON.parse(readFileSync(`public/${lang.path}`, 'utf8'));
  for (const t of p.titles) {
    const k = norm(t.t);
    if (!index.has(k)) index.set(k, { t: t.t, langs: new Set(), y: t.d, plats: new Set() });
    const e = index.get(k);
    e.langs.add(p.languageName);
    for (const x of t.p) e.plats.add(p.providers[String(x.id)]?.name ?? '?');
  }
}

const lines = readFileSync(process.argv[2], 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
const found = [], missing = [];
for (const line of lines) {
  const [name, group] = line.split('|').map((s) => s.trim());
  const hit = index.get(norm(name));
  if (hit) found.push({ name, group, hit });
  else missing.push({ name, group, cam: /\(cam\)/i.test(name) });
}

console.log(`\n${lines.length} sampled · ${found.length} in the feed · ${missing.length} not\n`);
console.log('FOUND:');
for (const f of found) console.log(`  ${f.name.slice(0,34).padEnd(36)} ${[...f.hit.langs].join(',').padEnd(18)} ${[...f.hit.plats].slice(0,3).join(', ')}`);
console.log('\nNOT IN FEED:');
for (const m of missing) console.log(`  ${m.name.slice(0,34).padEnd(36)} ${m.group ?? ''}${m.cam ? '   [cam rip]' : ''}`);
