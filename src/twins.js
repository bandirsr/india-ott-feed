/**
 * Folds a Wikipedia-sourced title into the TMDB title that is the same film.
 *
 * The Wikipedia layer (ETV Win and friends) names a film as the article does,
 * and TMDB spells it its own way: "Sampradayini Suppini Suddapoosani" against
 * "Sampradayaini Suppini Suddapusaani". gapfill matches on an exact normalised
 * title, so a one-letter difference left two rows for one film, and the
 * Wikipedia one had no poster, no trailer and no cinema date.
 *
 * This runs at publish time on one language's list. A match has to clear every
 * guard, because attaching a platform to the wrong film is worse than leaving a
 * duplicate:
 *   - the name is at least 5 letters (short names such as "Rush" are
 *     ambiguous), and a near-but-not-exact name must also be the same kind
 *     (movie or series);
 *   - the names are 85% similar or better, and within 4 letters in length;
 *   - the TMDB film's cinema year is not after the Wikipedia arrival year + 1
 *     and not more than 4 years before it (films stream after they open);
 *   - there is exactly one such candidate -- two close ones means we cannot
 *     tell, so neither is merged.
 */

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

export function similarity(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  return 1 - distance(x, y) / Math.max(x.length, y.length);
}

const yearOf = (iso) => (iso ? Number(String(iso).slice(0, 4)) || null : null);

export function mergeTwins(titles, { threshold = 0.85 } = {}) {
  const real = titles.filter((t) => !t.id.startsWith('wiki:'));
  const removed = new Set();
  const pairs = [];

  for (const w of titles) {
    if (!w.id.startsWith('wiki:')) continue;
    const wn = norm(w.t);
    if (wn.length < 5) continue;

    const arrivalYear = yearOf(w.p.find((r) => r.on)?.on);
    const candidates = real
      .filter((t) => Math.abs(norm(t.t).length - wn.length) <= 4)
      .filter((t) => {
        const cinema = yearOf(t.d);
        if (!arrivalYear || !cinema) return true;
        return cinema <= arrivalYear + 1 && cinema >= arrivalYear - 4;
      })
      .map((t) => ({ t, s: similarity(w.t, t.t) }))
      // Wikipedia entries are all filed as movies, but ETV Win has many series,
      // so an EXACT name may cross that line. A near name may not: a series and
      // a film with merely similar titles are far more likely to be two works.
      .filter((c) => c.s >= threshold && (c.s === 1 || c.t.k === w.k))
      .sort((a, b) => b.s - a.s);

    if (candidates.length === 0) continue;
    // An exact name beats a near one; otherwise two close candidates are a tie
    // we cannot break.
    if (candidates.length > 1 && candidates[0].s < 1 && candidates[1].s >= candidates[0].s - 0.03) continue;

    const target = candidates[0].t;
    for (const row of w.p) {
      if (!target.p.some((x) => x.id === row.id)) target.p.push(row);
    }
    removed.add(w);
    pairs.push([w.t, target.t]);
  }

  return { titles: titles.filter((t) => !removed.has(t)), merged: pairs.length, pairs };
}
