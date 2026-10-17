import { screenTitles, violations, isBlockedPlatformName } from '../src/safety.js';

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}`);
  }
};

const providers = { 8: { name: 'Netflix' }, '-2': { name: 'Ullu' }, 9: { name: 'Kooku' } };
const row = (id, t, pids, extra = {}) => ({ id, t, p: pids.map((p) => ({ id: p })), ...extra });

const r = screenTitles(
  [
    row('a', 'Plain film', [8]),
    row('b', 'Ullu original', [-2]),
    row('c', 'Mixed film', [-2, 8]),
    row('d', 'Some XXX thing', [8]),
    row('e', 'Normal title', [8], { syn: 'An erotic drama about a couple.' }),
    row('f', 'Terror thriller', [8], { syn: 'A hardcore terrorist plans an attack.' }),
    row('g', 'Flagged', [8], { a: 1 }),
    row('h', 'Sexy Durga', [8]),
  ],
  providers
);
const ids = r.kept.map((t) => t.id);
check('plain film is kept', ids.includes('a'));
check('adult-platform-only title is dropped', !ids.includes('b'));
check('mixed film keeps only its normal platform', ids.includes('c') && r.kept.find((t) => t.id === 'c').p.length === 1);
check('explicit title word is dropped', !ids.includes('d'));
check('explicit synopsis is dropped', !ids.includes('e'));
check('"hardcore terrorist" is not an adult signal', ids.includes('f'));
check('TMDB adult flag is dropped', !ids.includes('g'));
check('borderline title is kept but listed for review', ids.includes('h') && r.review.some((x) => x.id === 'h'));
check('platform names match loosely', isBlockedPlatformName('Ullu') && isBlockedPlatformName('KOOKU') && !isBlockedPlatformName('Netflix'));
check('violations() finds a leftover', violations({ providers, titles: [row('x', 'Porn star', [8])] }).length === 1);
check('violations() is empty for clean output', violations({ providers, titles: r.kept }).length === 0);

console.log(`safety: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
