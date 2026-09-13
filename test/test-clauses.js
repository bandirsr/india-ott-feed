/**
 * Regression tests for clause-level attribution.
 *
 * These exist because of a real failure found while running the pipeline on
 * live data: for Kalki 2898 AD, Netflix was credited with all five languages
 * when the source sentence gives it only Hindi. "Which platform for which
 * language" is the most important field in this dataset, so this is its own
 * test file rather than a footnote.
 */

import { extractAvailability } from '../src/extract.js';

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`);
    pass += 1;
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    fail += 1;
  }
}

const claimFor = (claims, platform) => claims.find((c) => c.platform === platform);

console.log('\nKalki 2898 AD — languages must not leak across a "while" clause');
{
  const text =
    'It premiered on Amazon Prime Video on 22 August 2024 in Telugu along with the Tamil, Malayalam and Kannada dubbed versions, while the Hindi dubbed version was released simultaneously on Netflix.';
  const claims = extractAvailability(text);
  const prime = claimFor(claims, 'Amazon Prime Video');
  const netflix = claimFor(claims, 'Netflix');

  check('Prime Video found', !!prime);
  check('Netflix found', !!netflix);
  check('Prime has Telugu', !!prime?.languages.includes('Telugu'));
  check('Netflix has Hindi', !!netflix?.languages.includes('Hindi'));
  check('Netflix does NOT have Telugu', !netflix?.languages.includes('Telugu'), String(netflix?.languages));
  check('Netflix has Hindi only', netflix?.languages.length === 1, String(netflix?.languages));
  check('Netflix inherits the sentence date', netflix?.date === '2024-08-22', String(netflix?.date));
}

console.log('\nRRR — same-day split across two platforms');
{
  const text =
    'The film started streaming on ZEE5 from 20 May 2022 in Telugu, Tamil, Malayalam and Kannada languages while the Hindi version was released on the same day on Netflix.';
  const claims = extractAvailability(text);
  const zee = claimFor(claims, 'ZEE5');
  const netflix = claimFor(claims, 'Netflix');

  check('ZEE5 has the four South languages', zee?.languages.length === 4, String(zee?.languages));
  check('ZEE5 does not have Hindi', !zee?.languages.includes('Hindi'));
  check('Netflix has Hindi only', netflix?.languages.length === 1 && netflix.languages[0] === 'Hindi', String(netflix?.languages));
  check('both share the 20 May date', zee?.date === '2022-05-20' && netflix?.date === '2022-05-20', `${zee?.date} / ${netflix?.date}`);
}

console.log('\nPromotional material is not availability');
{
  check('trailer on YouTube ignored', extractAvailability('The trailer was released on YouTube on 5 June 2024.').length === 0);
  check('song premiere ignored', extractAvailability('The first song premiered on YouTube on 1 May 2024.').length === 0);
  check('teaser ignored', extractAvailability('The teaser premiered on Netflix on 1 May 2024.').length === 0);
}

console.log(`\n${pass}/${pass + fail} checks passed.`);
if (fail > 0) {
  console.log(`${fail} FAILED`);
  process.exit(1);
}
console.log('Clause attribution OK.');
