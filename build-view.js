/**
 * Renders the catalogue JSON as a browsable page: trailer thumbnail, title,
 * theatrical date, and one badge per (platform, language) — with the thumbnail
 * linking straight to the trailer on YouTube, which is both the correct way to
 * use a YouTube thumbnail and genuinely how people decide what to watch.
 *
 * Run:  node build-view.js [data/sample.json] [view.html]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const PLATFORM_COLORS = {
  Netflix: '#E50914',
  'Amazon Prime Video': '#00A8E1',
  'Disney+ Hotstar': '#0E63E4',
  JioHotstar: '#0E63E4',
  JioCinema: '#8A2BE2',
  ZEE5: '#8230C6',
  SonyLIV: '#0B57D0',
  'Sun NXT': '#E0642C',
  'ETV Win': '#E4572E',
  aha: '#FF6A00',
  'Apple TV+': '#555555',
  'MX Player': '#2ABF9E',
  Hotstar: '#0E63E4',
};

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Groups availability rows so a platform appears once with its languages. */
function groupByPlatform(availability) {
  const map = new Map();
  for (const row of availability) {
    const existing = map.get(row.platform);
    if (existing) {
      if (!existing.languages.includes(row.language)) existing.languages.push(row.language);
      if (!existing.date && row.date) existing.date = row.date;
      if (row.dateStatus === 'disputed') existing.dateStatus = 'disputed';
    } else {
      map.set(row.platform, {
        platform: row.platform,
        languages: [row.language],
        date: row.date,
        dateStatus: row.dateStatus,
        platformConfidence: row.platformConfidence,
      });
    }
  }
  return [...map.values()];
}

function thumbBlock(film) {
  const t = film.trailer;
  if (t?.status === 'ok' && t.videoId) {
    return `
      <a class="thumb" href="${esc(t.watchUrl)}" target="_blank" rel="noopener noreferrer"
         title="Watch the trailer: ${esc(t.title)}">
        <img src="${esc(t.thumbnailHigh)}" alt="Trailer thumbnail for ${esc(film.title)}" loading="lazy"
             onerror="this.closest('.thumb').classList.add('broken')">
        <span class="play" aria-hidden="true">&#9654;</span>
        <span class="thumb-meta">${esc(t.channelTitle ?? 'YouTube')}</span>
      </a>`;
  }

  const reason =
    t?.status === 'no-api-key'
      ? 'No API key yet'
      : t?.status === 'quota-exceeded'
        ? 'Quota spent'
        : t?.status === 'no-confident-match'
          ? 'No confident trailer match'
          : t?.status === 'not-found'
            ? 'No trailer found'
            : 'Trailer pending';

  return `<div class="thumb placeholder"><span>${esc(reason)}</span></div>`;
}

function filmCard(film) {
  const platforms = groupByPlatform(film.availability ?? []);
  const credits = film.credits;

  const badges = platforms
    .map((p) => {
      const color = PLATFORM_COLORS[p.platform] ?? '#666';
      const langs = p.languages.filter((l) => l !== 'Unknown');
      return `
        <div class="badge">
          <span class="dot" style="background:${color}"></span>
          <span class="bname">${esc(p.platform)}</span>
          ${langs.length ? `<span class="langs">${esc(langs.join(' · '))}</span>` : ''}
          ${p.date ? `<span class="bdate${p.dateStatus === 'disputed' ? ' disputed' : ''}">${esc(fmtDate(p.date))}${p.dateStatus === 'disputed' ? ' ?' : ''}</span>` : '<span class="bdate none">date unknown</span>'}
        </div>`;
    })
    .join('');

  const cast = credits?.cast?.slice(0, 3).join(', ');

  return `
  <article class="card">
    ${thumbBlock(film)}
    <div class="body">
      <h2>${esc(film.title)}</h2>
      <p class="meta">
        ${film.theatricalDate ? `In cinemas ${esc(fmtDate(film.theatricalDate))}` : 'Theatrical date unknown'}
        ${credits?.directors?.length ? ` &middot; dir. ${esc(credits.directors.join(', '))}` : ''}
      </p>
      ${cast ? `<p class="cast">${esc(cast)}</p>` : ''}
      <div class="badges">${badges || '<p class="none">No streaming availability found</p>'}</div>
      ${film.trailer?.status === 'ok' ? `<a class="watch" href="${esc(film.trailer.watchUrl)}" target="_blank" rel="noopener noreferrer">Watch trailer on YouTube</a>` : ''}
    </div>
  </article>`;
}

function render(data) {
  const films = (data.films ?? []).filter((f) => f.status === 'ok' || (f.availability ?? []).length > 0);
  const withTrailer = films.filter((f) => f.trailer?.status === 'ok').length;
  const rows = films.reduce((s, f) => s + (f.availability?.length ?? 0), 0);

  return `<title>Telugu OTT Catalogue</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root {
    --ground:#F4F4F7; --surface:#FFF; --sunk:#ECEDF2; --ink:#14141C; --ink-mid:#4C4C5C;
    --ink-soft:#7A7A8C; --rule:#E0E1E8; --accent:#3B2FB8; --accent-soft:#E9E7FA;
    --good:#1C7350; --good-soft:#DEF1E8; --warn:#8A5B0E; --warn-soft:#FAEFD9;
    --serif:"Newsreader",Georgia,serif; --sans:"IBM Plex Sans",-apple-system,"Segoe UI",sans-serif;
    --mono:"IBM Plex Mono",Consolas,monospace;
  }
  @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
    --ground:#0C0C12; --surface:#16161F; --sunk:#1E1E2A; --ink:#EDEDF4; --ink-mid:#A9A9BC;
    --ink-soft:#78788C; --rule:#282836; --accent:#9B90F5; --accent-soft:#211D40;
    --good:#5FC79A; --good-soft:#112620; --warn:#DFA64F; --warn-soft:#2C2313;
  }}
  :root[data-theme="dark"]{
    --ground:#0C0C12; --surface:#16161F; --sunk:#1E1E2A; --ink:#EDEDF4; --ink-mid:#A9A9BC;
    --ink-soft:#78788C; --rule:#282836; --accent:#9B90F5; --accent-soft:#211D40;
    --good:#5FC79A; --good-soft:#112620; --warn:#DFA64F; --warn-soft:#2C2313;
  }
  *{box-sizing:border-box}
  body{background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1120px;margin:0 auto;padding:40px 22px 80px;display:flex;flex-direction:column;gap:30px}
  .kicker{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft);display:flex;gap:9px;flex-wrap:wrap}
  .kicker .s{color:var(--rule)}
  h1{font-family:var(--serif);font-size:clamp(32px,5vw,46px);font-weight:600;letter-spacing:-.02em;line-height:1.05;margin:0}
  .lede{font-family:var(--serif);font-size:18px;color:var(--ink-mid);margin:0;max-width:66ch}
  .stats{display:flex;gap:26px;flex-wrap:wrap;padding:18px 20px;background:var(--surface);border:1px solid var(--rule);border-radius:10px}
  .stat b{display:block;font-size:26px;font-weight:700;letter-spacing:-.5px;line-height:1.1}
  .stat span{font-size:12.5px;color:var(--ink-soft)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:18px}
  .card{background:var(--surface);border:1px solid var(--rule);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
  .thumb{position:relative;display:block;aspect-ratio:16/9;background:var(--sunk);overflow:hidden;text-decoration:none}
  .thumb img{width:100%;height:100%;object-fit:cover;display:block}
  .thumb.broken img{display:none}
  .thumb .play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.7);opacity:.92;transition:transform .15s}
  .thumb:hover .play{transform:scale(1.15)}
  .thumb-meta{position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.68);color:#fff;font-size:11px;padding:3px 7px;border-radius:4px;font-family:var(--mono);max-width:calc(100% - 16px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .thumb.placeholder{display:flex;align-items:center;justify-content:center}
  .thumb.placeholder span{font-family:var(--mono);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft)}
  .body{padding:16px;display:flex;flex-direction:column;gap:9px;flex:1}
  h2{font-family:var(--serif);font-size:21px;font-weight:600;letter-spacing:-.012em;line-height:1.18;margin:0}
  .meta{margin:0;font-size:13px;color:var(--ink-mid)}
  .cast{margin:0;font-size:12.5px;color:var(--ink-soft)}
  .badges{display:flex;flex-direction:column;gap:7px;margin-top:4px}
  .badge{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--sunk);border-radius:7px;padding:8px 10px}
  .dot{width:9px;height:9px;border-radius:50%;flex:none}
  .bname{font-weight:600;font-size:13.5px}
  .langs{font-size:12px;color:var(--ink-mid)}
  .bdate{margin-left:auto;font-family:var(--mono);font-size:11.5px;color:var(--good);background:var(--good-soft);padding:2px 6px;border-radius:4px;white-space:nowrap}
  .bdate.disputed{color:var(--warn);background:var(--warn-soft)}
  .bdate.none{color:var(--ink-soft);background:transparent}
  .none{font-size:13px;color:var(--ink-soft);margin:0}
  .watch{margin-top:auto;padding-top:8px;font-size:13px;font-weight:600;color:var(--accent);text-decoration:none}
  .watch:hover{text-decoration:underline}
  .foot{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);padding-top:20px;border-top:1px solid var(--rule)}
  a:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:3px}
</style>
<div class="wrap">
  <header style="display:flex;flex-direction:column;gap:12px">
    <div class="kicker"><span>Automated catalogue</span><span class="s">/</span><span>Telugu</span><span class="s">/</span><span>${esc(new Date(data.generatedAt ?? Date.now()).toISOString().slice(0, 10))}</span></div>
    <h1>Telugu OTT Catalogue</h1>
    <p class="lede">Built entirely from official public APIs — Wikipedia for availability, Wikidata for credits, YouTube for trailers. No scraping, no licence fees. Tap a thumbnail to watch the trailer.</p>
  </header>

  <div class="stats">
    <div class="stat"><b>${films.length}</b><span>films</span></div>
    <div class="stat"><b>${rows}</b><span>platform &times; language rows</span></div>
    <div class="stat"><b>${withTrailer}</b><span>trailers linked</span></div>
  </div>

  <div class="grid">
    ${films.map(filmCard).join('\n')}
  </div>

  <div class="foot">Sources: en.wikipedia.org Action API &middot; query.wikidata.org (CC0) &middot; YouTube Data API v3 &middot; thumbnails served by YouTube, linked to their videos</div>
</div>
`;
}

/**
 * Optionally embeds the thumbnails as data: URIs.
 *
 * Needed only when the page is viewed somewhere that blocks third-party images
 * (the Artifact viewer's content security policy does). A real app has no such
 * restriction and should link to i.ytimg.com directly — it is a CDN built for
 * exactly this, and inlining would bloat the payload for no gain.
 */
async function inlineThumbnails(data) {
  let done = 0;
  for (const film of data.films ?? []) {
    const t = film.trailer;
    if (t?.status !== 'ok' || !t.thumbnailHigh) continue;
    try {
      const res = await fetch(t.thumbnailHigh);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get('content-type') ?? 'image/jpeg';
      t.thumbnailHigh = `data:${mime};base64,${buf.toString('base64')}`;
      done += 1;
    } catch {
      // A thumbnail that will not fetch just stays a remote URL.
    }
  }
  return done;
}

const args = process.argv.slice(2).filter((a) => a !== '--inline');
const wantInline = process.argv.includes('--inline');

const inPath = resolve(HERE, args[0] ?? 'data/sample.json');
const outPath = resolve(HERE, args[1] ?? 'view.html');

const data = JSON.parse(readFileSync(inPath, 'utf8'));

if (wantInline) {
  const n = await inlineThumbnails(data);
  console.log(`Inlined ${n} thumbnails as data URIs`);
}

writeFileSync(outPath, render(data));
console.log(`Rendered ${data.films?.length ?? 0} films to ${outPath}`);
