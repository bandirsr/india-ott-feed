/**
 * Content safety: nothing adult or explicit reaches the app.
 *
 * Layers, from the source outward (all of them are needed, none is enough alone):
 *
 *   1. TMDB queries ask for include_adult=false (sweeps, search, discover).
 *   2. THIS FILE, at publish time: titles on adult-only platforms, and titles
 *      or synopses that name explicit content, are removed from every language
 *      file before the app can see them.
 *   3. verify-published.js re-checks the finished files with the same rules and
 *      fails the run if anything slipped through.
 *   4. Trailers: YouTube searches use safeSearch=strict, and every trailer key
 *      is checked for an age restriction (audit-trailers.mjs) and blocked.
 *
 * Borderline names (a word like "sex" in an acclaimed film's title) are NOT
 * hidden automatically: they are reported in the publish log for a human look,
 * because a blanket word ban would remove real, mainstream cinema.
 */

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Platforms whose catalogue is adult / erotic by design. Normalised names. */
export const BLOCKED_PLATFORMS = [
  'ullu',
  'kooku',
  'primeshots',
  'hunters',
  'rabbitmovies',
  'fugi',
  'nuefliks',
  'hotshots',
  'dreamsfilms',
  'boomex',
  'bigshots',
  'cineprime',
  'chikooflix',
  'balloonapp',
  'yessma',
];

/** Words that mean explicit content on their own. */
const EXPLICIT = /\b(porn\w*|xxx|erotic\w*|softcore|nude\s+web|adults?\s+only|18\s*\+\s*(only)?\s*(web|uncut)|uncut\s+(web\s+)?series|sexcapade\w*|kamasutra)\b/i;

/** Worth a human glance, never auto-hidden. */
const BORDERLINE = /\b(sex\w*|18\s*\+|hot|bold|uncut|nudity|bedroom|sunny\s+leone)\b/i;

export function isBlockedPlatformName(name) {
  const n = norm(name);
  return BLOCKED_PLATFORMS.some((b) => n === b || n.startsWith(b));
}

/** Why a title must not be shown, or null. `providers` maps id -> {name}. */
export function blockReason(title, providers) {
  const platforms = (title.p ?? []).map((e) => providers[String(e.id)]?.name).filter(Boolean);
  if (platforms.length > 0 && platforms.every(isBlockedPlatformName)) return `only on adult platform (${platforms[0]})`;
  if (title.a) return 'TMDB marks it adult';
  if (EXPLICIT.test(title.t ?? '')) return 'explicit word in title';
  if (EXPLICIT.test(title.syn ?? '')) return 'explicit word in synopsis';
  return null;
}

/**
 * Removes blocked titles and blocked-platform listings.
 * Mutates `titles` rows (drops blocked platform entries) and returns the kept list.
 */
export function screenTitles(titles, providers) {
  const kept = [];
  const dropped = [];
  const review = [];
  for (const t of titles) {
    // A film also on a normal platform keeps that listing; only the adult-platform entry goes.
    const clean = (t.p ?? []).filter((e) => !isBlockedPlatformName(providers[String(e.id)]?.name));
    const row = clean.length === (t.p ?? []).length ? t : { ...t, p: clean };
    const why = blockReason(row, providers);
    if (why || row.p.length === 0) {
      dropped.push({ id: t.id, t: t.t, why: why ?? 'no platform left after removing adult platforms' });
      continue;
    }
    if (BORDERLINE.test(row.t ?? '')) review.push({ id: t.id, t: t.t });
    kept.push(row);
  }
  return { kept, dropped, review };
}

/** For verify-published: every violation left in a finished payload. */
export function violations(payload) {
  const out = [];
  for (const t of payload.titles ?? []) {
    const why = blockReason(t, payload.providers ?? {});
    if (why) out.push(`${t.t} (${why})`);
    for (const e of t.p ?? []) {
      if (isBlockedPlatformName(payload.providers?.[String(e.id)]?.name)) out.push(`${t.t} (listed on adult platform)`);
    }
  }
  return out;
}
