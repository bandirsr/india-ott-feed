/**
 * The last gate: is what we just published actually usable?
 *
 * src/health.js guards the LEDGER — it refuses a sweep that would corrupt the
 * archive. This guards the OUTPUT, which is a different failure. A run can
 * pass every earlier check and still publish something the app cannot use: a
 * language file that lost its titles, a manifest pointing at a path that was
 * never written, attribution dropped (which is a licence breach, not a bug).
 *
 * Run last in the workflow. A failure here fails the job, and a failed job is
 * what sends the email — that is the entire alerting mechanism and it needs no
 * third-party service.
 *
 *   node verify-published.js
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), 'public');

/** Below this, a language file has plainly lost data rather than shrunk. */
const MIN_TITLES = { te: 1200, hi: 3000, ta: 1200, ml: 1200, kn: 500, bn: 500, mr: 200, pa: 200, gu: 50 };

const problems = [];
const ok = [];

function check(label, condition, detail = '') {
  if (condition) ok.push(label);
  else problems.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

const manifestPath = join(PUBLIC, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('FAILED: no manifest.json was written at all.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/* --- is it actually today's? -------------------------------------- */
const today = new Date().toISOString().slice(0, 10);
const ageDays = Math.round((Date.parse(today) - Date.parse(manifest.version)) / 86_400_000);
check('manifest is dated today or yesterday', ageDays <= 1, `it is ${ageDays} days old (${manifest.version})`);
check('buildId is present', Boolean(manifest.buildId), 'without it the app never re-downloads');

/* --- licence obligations ------------------------------------------ */
// Not optional and not cosmetic: publishing availability data without these
// credits is a breach of the TMDB terms this whole project runs under.
check('TMDB is credited', /TMDB/.test(manifest.attribution?.tmdb ?? ''));
check('JustWatch is credited', /JustWatch/.test(manifest.attribution?.justwatch ?? ''));

/* --- every language file is real ---------------------------------- */
for (const lang of manifest.languages ?? []) {
  const file = join(PUBLIC, lang.path);
  if (!existsSync(file)) {
    problems.push(`${lang.code}: manifest points at ${lang.path}, which was never written`);
    continue;
  }

  const payload = JSON.parse(readFileSync(file, 'utf8'));
  const floor = MIN_TITLES[lang.code] ?? 50;

  check(`${lang.code} has titles`, payload.titles.length > 0, 'the file is empty');
  check(`${lang.code} is above its floor`, payload.titles.length >= floor, `${payload.titles.length} titles, floor ${floor}`);
  check(`${lang.code} count matches the manifest`, payload.titles.length === lang.titles, `file ${payload.titles.length}, manifest ${lang.titles}`);
  check(`${lang.code} buildId matches`, payload.buildId === manifest.buildId, 'the app would re-download on every launch');
  check(`${lang.code} names its providers`, Object.keys(payload.providers ?? {}).length > 0, 'every platform would render as a bare number');

  // A title with no platform is a row the app cannot answer anything about.
  const orphans = payload.titles.filter((t) => !t.p || t.p.length === 0).length;
  check(`${lang.code} has no platformless titles`, orphans === 0, `${orphans} titles carry no platform`);
}

/* --- report ------------------------------------------------------- */
if (problems.length === 0) {
  const total = (manifest.languages ?? []).reduce((n, l) => n + l.titles, 0);
  console.log(`Published output verified: ${ok.length} checks, ${manifest.languages.length} languages, ${total} titles.`);
  console.log(`Version ${manifest.version} · build ${manifest.buildId}`);
  process.exit(0);
}

console.error(`\nPUBLISHED OUTPUT IS NOT USABLE — ${problems.length} problem(s):\n`);
for (const p of problems) console.error(`  - ${p}`);
console.error('\nThe app reads these files directly. Fix before the next run, or it serves this.');
process.exit(1);
