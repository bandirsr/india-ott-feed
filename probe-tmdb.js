/**
 * The coverage test: does TMDB actually know about Telugu films and aha?
 *
 * A provider appearing in a region list is not the same as titles being tagged
 * to it. Watchmode listed 29 India sources and omitted aha entirely; the point
 * here is to check that TMDB both LISTS aha and USES it on real Telugu films.
 *
 * Run:  node probe-tmdb.js
 */

import { loadTmdbKey, watchProviders, discoverByLanguage, movieProviders } from './src/tmdb.js';

if (!loadTmdbKey()) {
  console.error('No TMDB_API_KEY in .env — add it and re-run.');
  process.exit(1);
}

const WANTED = /^(aha|etv ?win|sun ?nxt|zee5|jiohotstar|hotstar|sony ?liv|netflix|amazon prime video|jiocinema|manoramamax|hoichoi|mx player)/i;

async function main() {
  console.log('=== 1. Providers TMDB lists for India ===\n');
  const providers = await watchProviders('IN', 'movie');
  console.log(`${providers.length} providers in India\n`);

  const key = providers.filter((p) => WANTED.test(p.name)).sort((a, b) => a.priority - b.priority);
  for (const p of key) console.log(`  id ${String(p.id).padEnd(6)}${p.name}`);

  const aha = providers.find((p) => /^aha$/i.test(p.name));
  const etv = providers.find((p) => /etv/i.test(p.name));
  console.log(`\n  aha present:      ${aha ? 'YES  (id ' + aha.id + ')' : 'NO'}`);
  console.log(`  ETV Win present:  ${etv ? 'YES  (id ' + etv.id + ')' : 'NO'}`);

  console.log('\n=== 2. Recent Telugu films TMDB knows about ===\n');
  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

  const recent = await discoverByLanguage({
    language: 'te',
    region: 'IN',
    fromDate: ninetyAgo,
    toDate: today,
  });
  console.log(`${recent.totalResults} Telugu films released in the last 90 days\n`);

  // Availability is the real test — how many of these are tagged to a platform,
  // and does aha ever actually appear?
  let withProviders = 0;
  let onAha = 0;
  const sample = recent.films.slice(0, 15);

  for (const film of sample) {
    const p = await movieProviders(film.id, 'IN');
    const all = [...p.flatrate, ...p.free, ...p.rent, ...p.buy];
    const names = [...new Set(all.map((x) => x.name))];
    if (p.flatrate.length > 0 || p.free.length > 0) withProviders += 1;
    if (names.some((n) => /^aha$/i.test(n))) onAha += 1;

    console.log(
      `  ${String(film.releaseDate ?? '?').padEnd(12)}${String(film.title).padEnd(30).slice(0, 30)} ${
        names.length ? names.join(', ') : '— no provider listed —'
      }`
    );
  }

  console.log(`\n  ${withProviders}/${sample.length} of the sample have a streaming provider`);
  console.log(`  ${onAha}/${sample.length} are on aha`);

  console.log('\n=== 3. Everything currently on aha in Telugu ===\n');
  if (aha) {
    const ahaFilms = await discoverByLanguage({
      language: 'te',
      region: 'IN',
      providers: aha.id,
      sortBy: 'primary_release_date.desc',
    });
    console.log(`${ahaFilms.totalResults} Telugu films tagged to aha\n`);
    for (const f of ahaFilms.films.slice(0, 12)) {
      console.log(`  ${String(f.releaseDate ?? '?').padEnd(12)}${f.title}`);
    }
  } else {
    console.log('  aha is not a TMDB provider in India — skipping.');
  }

  console.log('\n--- Verdict ---');
  console.log(`aha usable:        ${aha ? 'yes' : 'no'}`);
  console.log(`ETV Win usable:    ${etv ? 'yes' : 'no — needs another source'}`);
  console.log(`Telugu catalogue:  ${recent.totalResults} films in 90 days`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
