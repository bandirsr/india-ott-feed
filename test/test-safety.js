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

{
  const rules = { certs: { 'movie:1': { c: 'A' }, 'movie:2': { c: 'UA' } }, manual: { 'movie:3': 'by hand' } };
  const k = screenTitles([row('movie:1', 'Cert A', [8]), row('movie:2', 'Cert UA', [8]), row('movie:3', 'Hand blocked', [8]), row('movie:4', 'No cert', [8])], providers, rules).kept.map((t) => t.id);
  check('certificate A is removed', !k.includes('movie:1'));
  check('certificate UA is kept', k.includes('movie:2'));
  check('hand-blocked title is removed', !k.includes('movie:3'));
  check('unrated film is kept (no evidence against it)', k.includes('movie:4'));
}

{
  const rules = { certs: { 'movie:10': { c: 'A' }, 'movie:11': { c: 'A' }, 'movie:12': { c: 'A' }, 'movie:13': { c: 'A' } }, manual: {} };
  const kept = (rows) => screenTitles(rows, providers, rules).kept.map((x) => x.id);
  const k = kept([
    row('movie:10', 'Violent hit', [8], { syn: 'A gangster wages a bloody war against a rival clan.' }),
    row('movie:11', 'Steamy one', [8], { syn: 'A married man begins an extramarital relationship.' }),
    row('movie:12', 'No description', [8]),
    row('movie:13', 'Essex story', [8], { syn: 'Fourteen friends visit Essex for a heist.' }),
    row('movie:14', 'Child case', [8], { syn: 'A teenage girl is sexually abused and seeks justice.' }),
    row('movie:15', 'Kids film', [8], { syn: 'Kids go on a school trip and find a treasure.' }),
  ]);
  check('A film with violence only stays', k.includes('movie:10'));
  check('A film with sexual terms is hidden', !k.includes('movie:11'));
  check('A film with no description is hidden', !k.includes('movie:12'));
  check('word boundaries: Essex/fourteen do not trigger', k.includes('movie:13'));
  check('child + sexual abuse is hidden whatever the rating', !k.includes('movie:14'));
  check('ordinary kids film is kept', k.includes('movie:15'));
}

console.log(`safety: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
