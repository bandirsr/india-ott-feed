/**
 * Tests the extractor against real sentences pulled from Wikipedia on
 * 2026-09-12. Each case is verbatim — no paraphrasing — so a passing run means
 * the parser handles the phrasing Wikipedia actually uses.
 */

import { extractAvailability, extractTheatricalDate } from '../src/extract.js';

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

function claimFor(claims, platform) {
  return claims.find((c) => c.platform === platform);
}

console.log('\nKalki 2898 AD — two platforms, one sentence, split by language');
{
  const text =
    'It premiered on Amazon Prime Video on 22 August 2024 in Telugu along with the Tamil, Malayalam and Kannada dubbed versions, while the Hindi dubbed version was released simultaneously on Netflix.';
  const claims = extractAvailability(text);
  check('found Amazon Prime Video', !!claimFor(claims, 'Amazon Prime Video'));
  check('found Netflix', !!claimFor(claims, 'Netflix'));
  check('Prime date is 2024-08-22', claimFor(claims, 'Amazon Prime Video')?.date === '2024-08-22', claimFor(claims, 'Amazon Prime Video')?.date);
  check('did not invent a third platform', claims.length === 2, `got ${claims.length}`);
}

console.log('\nDevara: Part 1 — rights sentence then a real release sentence');
{
  const text =
    'The digital distribution rights of the film were acquired by Netflix for ₹155 crore. The film began streaming on Netflix from 8 November 2024 in Telugu and dubbed versions of Tamil, Malayalam and Kannada languages. The Hindi dubbed version of the film began streaming from 22 November 2024.';
  const claims = extractAvailability(text);
  const netflix = claims.filter((c) => c.platform === 'Netflix');
  check('Netflix claim exists', netflix.length > 0);
  check('picked up the 8 Nov release date', netflix.some((c) => c.date === '2024-11-08'), JSON.stringify(netflix.map((c) => c.date)));
  check('Telugu is among the languages', netflix.some((c) => c.languages.includes('Telugu')));
}

console.log('\nGuntur Kaaram — "acquired by X and premiered from DATE"');
{
  const text =
    'The film digital distribution rights were acquired by Netflix and premiered from 9 February 2024 in Telugu, Tamil, Malayalam, Kannada and Hindi.';
  const claims = extractAvailability(text);
  check('Netflix found', !!claimFor(claims, 'Netflix'));
  check('date is 2024-02-09', claimFor(claims, 'Netflix')?.date === '2024-02-09', claimFor(claims, 'Netflix')?.date);
  check('five languages captured', claimFor(claims, 'Netflix')?.languages.length === 5, String(claimFor(claims, 'Netflix')?.languages));
}

console.log('\nRRR — two platforms, two language groups, same day');
{
  const text =
    'The film started streaming on ZEE5 from 20 May 2022 in Telugu, Tamil, Malayalam and Kannada languages while the Hindi version was released on the same day on Netflix.';
  const claims = extractAvailability(text);
  check('ZEE5 found', !!claimFor(claims, 'ZEE5'));
  check('Netflix found', !!claimFor(claims, 'Netflix'));
  check('ZEE5 date is 2022-05-20', claimFor(claims, 'ZEE5')?.date === '2022-05-20', claimFor(claims, 'ZEE5')?.date);
}

console.log('\nSalaar — Disney+ Hotstar must not be read as bare Hotstar');
{
  const text = 'The Hindi dubbed version premiered on Disney+ Hotstar from 16 February 2024.';
  const claims = extractAvailability(text);
  check('Disney+ Hotstar found', !!claimFor(claims, 'Disney+ Hotstar'));
  check('bare Hotstar NOT also reported', !claimFor(claims, 'Hotstar'), 'both matched');
  check('only one claim', claims.length === 1, `got ${claims.length}`);
  check('Hindi captured', claimFor(claims, 'Disney+ Hotstar')?.languages.includes('Hindi'));
}

console.log('\nSalaar — a TV premiere is not streaming availability');
{
  const text = 'The original Telugu-language version of the film was premiered on television on 21 April 2024 on Star Maa.';
  const claims = extractAvailability(text);
  const starmaa = claimFor(claims, 'Star Maa');
  check('Star Maa found', !!starmaa);
  check('classified as tv, not ott', starmaa?.kind === 'tv', starmaa?.kind);
  check('no OTT claim produced', claims.filter((c) => c.kind === 'ott').length === 0);
}

console.log('\nHanu-Man — simple "premiered on X on DATE"');
{
  const text = 'The film premiered on ZEE5 on 16 March 2024.';
  const claims = extractAvailability(text);
  check('ZEE5 found', !!claimFor(claims, 'ZEE5'));
  check('date is 2024-03-16', claimFor(claims, 'ZEE5')?.date === '2024-03-16', claimFor(claims, 'ZEE5')?.date);
}

console.log('\nPushpa 2 — date format and a qualified subject');
{
  const text =
    "The film's reloaded version, which included over 20 minutes of additional footage, began streaming on Netflix from 30 January 2025 in Telugu and dubbed versions of Hindi, Tamil, Malayalam and Kannada languages.";
  const claims = extractAvailability(text);
  check('Netflix found', !!claimFor(claims, 'Netflix'));
  check('date is 2025-01-30', claimFor(claims, 'Netflix')?.date === '2025-01-30', claimFor(claims, 'Netflix')?.date);
}

console.log('\nNegative cases — must NOT produce availability');
{
  check(
    'a pure rights sentence yields no date',
    extractAvailability('Netflix acquired the rights for ₹175 crore.').every((c) => c.date === null)
  );
  check('no platform means no claim', extractAvailability('The film was a commercial success.').length === 0);
  check(
    'a platform with no verb is ignored',
    extractAvailability('Netflix is a streaming company based in California.').length === 0
  );
}

console.log('\nTheatrical date');
{
  const t1 = extractTheatricalDate('The film was released worldwide on 27 June 2024 to positive reviews.');
  check('found 2024-06-27', t1?.date === '2024-06-27', t1?.date);
  const t2 = extractTheatricalDate('The film began streaming on Netflix from 8 November 2024.');
  check('a streaming sentence is not read as theatrical', t2 === null, JSON.stringify(t2));
}

console.log('\nAmerican date format');
{
  const claims = extractAvailability('The film premiered on Netflix on January 30, 2025.');
  check('parsed "January 30, 2025"', claimFor(claims, 'Netflix')?.date === '2025-01-30', claimFor(claims, 'Netflix')?.date);
}

console.log(`\n${pass}/${pass + fail} checks passed.`);
if (fail > 0) {
  console.log(`${fail} FAILED`);
  process.exit(1);
}
console.log('Extractor OK.');
