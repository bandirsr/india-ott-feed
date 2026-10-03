import { mergeTwins } from '../src/twins.js';

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}`);
  }
};

const tm = (id, t, d, pid = 8) => ({ id: `movie:${id}`, t, d, i: '/p.jpg', k: 'movie', y: null, p: [{ id: pid, on: null }] });
const wk = (slug, t, on) => ({ id: `wiki:${slug}`, t, d: null, i: null, k: 'movie', y: null, p: [{ id: -1, on, src: 'wikipedia' }] });

// The real case: one-letter spelling differences
{
  const list = [tm(1, 'Sampradayaini Suppini Suddapusaani', '2026-02-12'), wk('s', 'Sampradayini Suppini Suddapoosani', '2026-02-12')];
  const r = mergeTwins(list);
  check('spelling variant is merged', r.merged === 1 && r.titles.length === 1);
  check('merged row keeps the TMDB title and poster', r.titles[0].id === 'movie:1' && r.titles[0].i === '/p.jpg');
  check('merged row carries both platforms', r.titles[0].p.length === 2 && r.titles[0].p.some((x) => x.id === -1 && x.on === '2026-02-12'));
}

// Exact name
{
  const r = mergeTwins([tm(2, 'Constable Kanakam', '2025-08-01'), wk('c', 'Constable Kanakam', '2025-09-01')]);
  check('exact name is merged', r.merged === 1);
}

// Guards: nothing should merge
check('different film with a similar name is left alone', mergeTwins([tm(3, 'Krishna Rama Raju', '2026-01-01'), wk('k', 'Krishna Rama', '2026-02-01')]).merged === 0);
check('short names are never merged', mergeTwins([tm(4, 'Rush', '2026-01-01'), wk('r', 'Rush', '2026-02-01')]).merged === 0);
check('a similar-but-not-identical series name is not matched to a movie', mergeTwins([{ ...tm(5, 'Thulasivanam', '2026-01-01'), k: 'tv' }, wk('t', 'Thulasivanamm', '2026-02-01')]).merged === 0);
check('an exact name matches even when TMDB files it as a series', mergeTwins([{ ...tm(10, 'Constable Kanakam', '2026-01-01'), k: 'tv' }, wk('ck', 'Constable Kanakam', '2026-02-01')]).merged === 1);
check('a film from far too long ago is not matched', mergeTwins([tm(6, 'Sammelanam Special', '2005-01-01'), wk('s2', 'Sammelanam Special', '2026-02-01')]).merged === 0);
check('two equally close candidates are a tie, so nothing merges', mergeTwins([tm(7, 'Leela Vinodhaam', '2026-01-01'), tm(8, 'Leela Vinodhamm', '2026-01-02'), wk('l', 'Leela Vinodham', '2026-02-01')]).merged === 0);
check('a provider already on the TMDB row is not added twice', (() => {
  const t = tm(9, 'Duplicate Check', '2026-01-01', -1);
  const r = mergeTwins([t, wk('d', 'Duplicate Check', '2026-02-01')]);
  return r.titles[0].p.length === 1;
})());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
