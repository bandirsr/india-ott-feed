import { streamingRows, recordsFromCache, wikiLink, EARLIEST } from '../src/wikilang.js';

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}`);
  }
};

const today = '2026-10-09';

const film = (extra) => `Example Film is a 2026 Indian Kannada-language action film directed by A. B. and produced by C. D. under the banner E.

== Cast ==
Some actors appear in the film.

== Release ==
The film was released theatrically on 30 April 2026.

=== Home media ===
${extra}
`;

// the KD case: ZEE5, exact date, the film's own language
const kd = streamingRows(film('The film began streaming on ZEE5 from 5 June 2026 in Kannada and dubbed versions of Tamil, Telugu and Malayalam languages.'), 'Kannada', { today });
check('a dated streaming line in the film\'s own language is kept', kd.length === 1 && kd[0].platform === 'ZEE5' && kd[0].date === '2026-06-05');

// a dubbed-only line belongs to another language's chip
const dub = streamingRows(film('The Hindi dubbed version began streaming on Netflix from 12 June 2026 in Hindi.'), 'Kannada', { today });
check('a dubbed version in another language is not filed under this one', dub.length === 0);

// not yet happened
const future = streamingRows(film('The film will begin streaming on ZEE5 from 20 December 2026 in Kannada.'), 'Kannada', { today });
check('a future date is not kept as an arrival', future.length === 0);

// old
const old = streamingRows(film('The film began streaming on ZEE5 from 5 June 2025 in Kannada.'), 'Kannada', { today });
check('a date before the window is history, not news', old.length === 0 && '2025-06-05' < EARLIEST);

// no date
const undated = streamingRows(film('The film began streaming on ZEE5 in Kannada.'), 'Kannada', { today });
check('a line with no exact date is skipped', undated.length === 0);

// not a film article
check('empty text gives nothing', streamingRows('', 'Kannada', { today }).length === 0);

// recordsFromCache: only matched films, newest first, real TMDB title, Wikipedia link
const cache = {
  a: { wikiTitle: 'KD: The Devil', language: 'Kannada', tmdb: { key: 'movie:1103473', title: 'KD – The Devil' }, rows: [{ platform: 'ZEE5', date: '2026-06-05', evidence: '=== Home media ===\nThe film began streaming on ZEE5.' }] },
  b: { wikiTitle: 'Unmatched Film', language: 'Kannada', tmdb: null, rows: [{ platform: 'ZEE5', date: '2026-07-01', evidence: 'x' }] },
  c: null,
  d: { wikiTitle: 'Newer', language: 'Marathi', tmdb: { key: 'movie:9', title: 'Newer' }, rows: [{ platform: 'Netflix', date: '2026-09-30', evidence: 'y' }] },
};
const recs = recordsFromCache(cache);
check('an unmatched film is never published', recs.length === 2 && !recs.some((r) => r.title === 'Unmatched Film'));
check('records are newest first', recs[0].date === '2026-09-30' && recs[1].date === '2026-06-05');
check('the TMDB title is used, not the Wikipedia one', recs[1].title === 'KD – The Devil');
check('each record names its language and carries a source link', recs[1].languages[0] === 'Kannada' && recs[1].link === wikiLink('KD: The Devil'));
check('the section heading is stripped from the headline', !recs[1].headline.includes('Home media'));
check('records are shaped like news releases', recs.every((r) => r.kind === 'release' && r.dateStatus === 'reported' && r.source === 'wikipedia'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
