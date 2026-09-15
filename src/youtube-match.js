/**
 * Deciding whether a YouTube search result is a film's trailer.
 *
 * Kept apart from the pass that calls YouTube so the rules can be tested
 * without spending quota -- and because the rules are the part that can be
 * wrong. Searching "<title> <year> trailer" and taking the top hit returns fan
 * edits, reaction videos and a different film with the same name. A missing
 * trailer costs a reader nothing they did not already lack; a wrong one sends
 * them to someone else's film under our name. So the bar is strict.
 */

export const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const decode = (s) =>
  String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/**
 * Accept only when the video title contains the film's title, says trailer or
 * teaser, is not a reaction or fan cut, and does not name a different year.
 */
export function accept(film, video) {
  const vt = norm(decode(video.title));
  const ft = norm(film.title);
  if (ft.length < 2) return { ok: false, why: 'title too short to match safely' };
  // The film's title must LEAD the video name, after any generic prefix like
  // "Official Trailer:". Containing it anywhere was the first rule, and it
  // attached "Shiva" (2012) to "Ayyappa 2012-13 shiva studio Trailer 2" --
  // a different film whose uploader happened to be called Shiva Studio. Real
  // trailers name the film first; the words after it are cast, label, noise.
  const lead = vt.replace(/^((official|new|latest|hd|full|movie|film|trailer|teaser)\s+)+/, '');
  if (!(lead === ft || lead.startsWith(`${ft} `))) {
    return { ok: false, why: 'video name does not start with the title' };
  }
  if (!/\b(trailer|teaser)\b/.test(vt)) return { ok: false, why: 'not a trailer or teaser' };
  if (/\b(reaction|review|explained|breakdown|recap|spoof|fan made|fanmade|scene|song)\b/.test(vt)) {
    return { ok: false, why: 'reaction, fan or clip content' };
  }
  const years = vt.match(/\b(19|20)\d{2}\b/g) ?? [];
  if (film.year && years.length > 0 && !years.includes(String(film.year))) {
    return { ok: false, why: `names a different year (${years.join(',')})` };
  }
  return { ok: true, confidence: film.year && years.includes(String(film.year)) ? 'high' : 'medium' };
}
