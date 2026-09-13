/**
 * The published JSON is the contract between two codebases that are versioned
 * separately and deployed separately: this pipeline writes it, OTT_APP's
 * src/feed.ts reads it. Nothing in either repo would catch a renamed field —
 * the app would just quietly show an empty list to everyone.
 *
 * So every field feed.ts touches is asserted here, by name.
 *
 * Run after publish: node test/test-feed-contract.js
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

if (!existsSync(join(PUBLIC, 'manifest.json'))) {
  console.error('No published output. Run "node publish.js" first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.json'), 'utf8'));

/* ---- manifest: every field src/feed.ts reads ---- */
for (const field of ['version', 'buildId', 'generatedAt', 'region', 'trackingSince', 'imageBase', 'posterSize', 'languages']) {
  check(`manifest has ${field}`, manifest[field] !== undefined);
}
check('manifest version is an ISO date', /^\d{4}-\d{2}-\d{2}$/.test(manifest.version), manifest.version);
check('imageBase ends in a slash so paths concatenate', manifest.imageBase.endsWith('/'), manifest.imageBase);
check('imageBase is https', manifest.imageBase.startsWith('https://'));
check('posterSize is a TMDB size token', /^w\d+$/.test(manifest.posterSize), manifest.posterSize);
check('languages is a non-empty array', Array.isArray(manifest.languages) && manifest.languages.length > 0);

/* Attribution is a licence obligation, not a nicety — if it stops being
   published the app has nothing to render and ships in breach. */
check('attribution credits TMDB', /TMDB/.test(manifest.attribution?.tmdb ?? ''));
check('attribution credits JustWatch', /JustWatch/.test(manifest.attribution?.justwatch ?? ''));

for (const lang of manifest.languages) {
  for (const field of ['code', 'name', 'titles', 'bytes', 'gzipBytes', 'path']) {
    check(`language ${lang.code} has ${field}`, lang[field] !== undefined);
  }
  check(`${lang.code} path is relative, not absolute`, !lang.path.startsWith('/'), lang.path);
  check(`${lang.code} file exists at its advertised path`, existsSync(join(PUBLIC, lang.path)));
}

/* ---- each language payload ---- */
let checkedTitles = 0;

for (const lang of manifest.languages) {
  const payload = JSON.parse(readFileSync(join(PUBLIC, lang.path), 'utf8'));

  for (const field of ['version', 'buildId', 'language', 'languageName', 'trackingSince', 'providers', 'titles']) {
    check(`${lang.code}.json has ${field}`, payload[field] !== undefined);
  }
  check(`${lang.code} version matches the manifest`, payload.version === manifest.version);
  // The cache-busting field. If these ever drift, the app downloads a language
  // file and immediately considers it stale, re-downloading on every launch.
  check(`${lang.code} buildId matches the manifest`, payload.buildId === manifest.buildId);
  check(`${lang.code} code matches the manifest`, payload.language === lang.code);
  check(`${lang.code} title count matches the manifest`, payload.titles.length === lang.titles);

  for (const p of Object.values(payload.providers)) {
    check(`${lang.code} provider has a name`, typeof p.name === 'string' && p.name.length > 0);
    check(`${lang.code} provider colour is a hex triple`, /^#[0-9A-Fa-f]{6}$/.test(p.color), p.color);
  }

  // Sampled rather than exhaustive: 11,000 titles would make the output
  // unreadable, and a shape error is never confined to one record.
  for (const title of payload.titles.slice(0, 25)) {
    checkedTitles += 1;
    check(`${lang.code} title has id`, typeof title.id === 'string');
    // Three sources of id now. 'movie:' and 'tv:' are TMDB; 'wiki:' is a title
    // only Wikipedia knows about, which is the entire point of the gap-fill
    // robot -- small films that went only to ETV Win and that TMDB has never
    // heard of.
    check(
      `${lang.code} id is source-prefixed`,
      /^(movie|tv):\d+$/.test(title.id) || /^wiki:.+/.test(title.id),
      title.id
    );
    check(`${lang.code} title has a name`, typeof title.t === 'string' && title.t.length > 0);
    check(`${lang.code} kind is movie or tv`, title.k === 'movie' || title.k === 'tv', title.k);
    check(
      `${lang.code} kind agrees with the id prefix`,
      title.id.startsWith('wiki:') ? title.k === 'movie' : title.id.startsWith(`${title.k}:`)
    );
    check(`${lang.code} date is an ISO date or null`, title.d === null || /^\d{4}-\d{2}-\d{2}$/.test(title.d), String(title.d));

    // The app builds a URL as imageBase + posterSize + i, so a missing leading
    // slash would produce a 404 on every poster.
    check(`${lang.code} poster path starts with /`, title.i === null || title.i.startsWith('/'), String(title.i));

    check(`${lang.code} platform list is a non-empty array`, Array.isArray(title.p) && title.p.length > 0);
    for (const entry of title.p) {
      check(`${lang.code} platform entry has a numeric id`, typeof entry.id === 'number');
      check(`${lang.code} platform id resolves to a provider`, payload.providers[String(entry.id)] !== undefined, String(entry.id));
      check(
        `${lang.code} arrival date is an ISO date or null`,
        entry.on === null || /^\d{4}-\d{2}-\d{2}$/.test(entry.on),
        String(entry.on)
      );
      // An arrival we OBSERVED cannot predate the day we started watching.
      // One we were TOLD about can: Wikipedia cites dates going back years, and
      // for ETV Win titles that citation is the only arrival date in existence,
      // since TMDB records none at all. Rows carrying src say where they came
      // from precisely so this distinction survives into the app.
      const observed = !entry.src;
      check(
        `${lang.code} observed arrival is not before tracking started`,
        entry.on === null || !observed || entry.on >= payload.trackingSince,
        `${entry.on} < ${payload.trackingSince}`
      );
      check(
        `${lang.code} a sourced arrival names its source`,
        entry.src === undefined || entry.src === 'wikipedia',
        String(entry.src)
      );
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed  (${manifest.languages.length} languages, ${checkedTitles} titles sampled)`);
process.exit(failed === 0 ? 0 : 1);
