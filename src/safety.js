/**
 * Content safety: nothing adult or explicit reaches the app.
 *
 * Also: Indian film certificate "A" (data/certifications.json, certs.js) and a
 * hand-kept list (data/blocked-titles.json).
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

/**
 * Sexual or exploitative terms. Applied only to films certified A: an A film
 * stays visible when its title and description contain none of these, and is
 * hidden when they do (or when there is no description to judge it by).
 */
const SEXUAL = /\b(sex\w*|seduc\w*|erotic\w*|nud(e|ity|es)\b|porn\w*|lust\w*|steamy|sensual\w*|adulter\w*|extra-?marital|illicit|prostitut\w*|brothel\w*|call[- ]girl\w*|rape\w*|raped|molest\w*|incest\w*|virgin\w*|mistress\w*|orgy|one[- ]night[- ]stand|intimate scenes?|bold scenes?|sleeps? with|flirt\w*|bedroom|bed\s*room|fling)\b/i;

/**
 * Child safety, for EVERY film whatever its certificate: a child or minor
 * together with sexual or abusive content, plus the direct terms. Deliberately
 * wide; a film about child abuse awareness is hidden too. Wrongly hiding a film
 * costs little, showing one costs a great deal.
 */
const CHILD = /\b(child\w*|minors?|under-?age\w*|school ?girls?|school ?boys?|teen(age|ager|agers|s)?|toddlers?|kids?|juvenile\w*|pre-?teen\w*)\b/i;
const ABUSE = /\b(sexual\w*|sex|rape\w*|raped|molest\w*|abus\w*|exploit\w*|traffick\w*|porn\w*|nude\w*|incest\w*|seduc\w*|prostitut\w*|pedoph\w*|paedoph\w*|lust\w*|erotic\w*)\b/i;
const CHILD_DIRECT = /\b(pedoph\w*|paedoph\w*|pocso|child (abuse|porn\w*|molest\w*|sexual\w*|exploitation|trafficking)|sexual abuse of (a )?(child|minor)s?)\b/i;

export function childRisk(text) {
  return CHILD_DIRECT.test(text) || (CHILD.test(text) && ABUSE.test(text));
}

/** Worth a human glance, never auto-hidden. */
const BORDERLINE = /\b(sex\w*|18\s*\+|hot|bold|uncut|nudity|bedroom|sunny\s+leone)\b/i;

export function isBlockedPlatformName(name) {
  const n = norm(name);
  return BLOCKED_PLATFORMS.some((b) => n === b || n.startsWith(b));
}

/** Why a title must not be shown, or null. `providers` maps id -> {name}. */
export function blockReason(title, providers, rules = {}) {
  if (rules.manual && rules.manual[title.id]) return `blocked by hand: ${rules.manual[title.id]}`;
  const text = `${title.t ?? ''} ${title.syn ?? ''}`;
  if (childRisk(text)) return 'child-safety: child/minor with sexual or abusive content';
  if (rules.certs?.[title.id]?.c === 'A') {
    if (!title.syn) return 'certified A, no description to judge it by';
    if (SEXUAL.test(text)) return 'certified A with sexual terms in title or description';
  }
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
export function screenTitles(titles, providers, rules = {}) {
  const kept = [];
  const dropped = [];
  const review = [];
  for (const t of titles) {
    // A film also on a normal platform keeps that listing; only the adult-platform entry goes.
    const clean = (t.p ?? []).filter((e) => !isBlockedPlatformName(providers[String(e.id)]?.name));
    const row = clean.length === (t.p ?? []).length ? t : { ...t, p: clean };
    const why = blockReason(row, providers, rules);
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
export function violations(payload, rules = {}) {
  const out = [];
  for (const t of payload.titles ?? []) {
    const why = blockReason(t, payload.providers ?? {}, rules);
    if (why) out.push(`${t.t} (${why})`);
    for (const e of t.p ?? []) {
      if (isBlockedPlatformName(payload.providers?.[String(e.id)]?.name)) out.push(`${t.t} (listed on adult platform)`);
    }
  }
  return out;
}
