/**
 * Interactive mockup of the actual app, built from the real catalogue data.
 *
 * All four list views ship as a user choice, reachable from a "View" control in
 * the app bar and remembered between launches. The default is "By date" with
 * compact rows, so the app works well for someone who never opens that menu —
 * a switcher is only a good idea if the default needs no explanation.
 *
 * The language picker is not decoration: Telugu releases split across platforms
 * by language, so switching Telugu to Hindi genuinely moves Kalki 2898 AD from
 * Prime Video to Netflix. That is why records are (platform x language).
 *
 * Run:  node build-mockup.js
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
  'Apple TV+': '#555',
  'MX Player': '#2ABF9E',
};

const PLATFORM_SHORT = {
  'Amazon Prime Video': 'Prime Video',
  'Disney+ Hotstar': 'Hotstar',
};

async function inlineThumb(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${res.headers.get('content-type') ?? 'image/jpeg'};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function buildRecords(data) {
  const out = [];
  for (const film of data.films ?? []) {
    if (!film.availability?.length) continue;
    let thumb = null;
    if (film.trailer?.status === 'ok' && film.trailer.thumbnailHigh) {
      thumb = await inlineThumb(film.trailer.thumbnailHigh);
    }
    out.push({
      title: film.title,
      theatrical: film.theatricalDate,
      director: film.credits?.directors?.[0] ?? null,
      cast: (film.credits?.cast ?? []).slice(0, 2),
      thumb,
      hasTrailer: film.trailer?.status === 'ok',
      rows: film.availability.map((a) => ({
        platform: a.platform,
        short: PLATFORM_SHORT[a.platform] ?? a.platform,
        color: PLATFORM_COLORS[a.platform] ?? '#777',
        language: a.language,
        date: a.date,
        dateStatus: a.dateStatus,
      })),
    });
  }
  return out;
}

function render(records) {
  const json = JSON.stringify(records).replace(/</g, '\\u003c');

  return `<title>Streaming App Mockup</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
  :root{
    --stage:#14141B; --stage2:#0A0A0F;
    --bg:#F3F3F7; --surface:#FFF; --sunk:#EAEAF1; --ink:#14141C; --mid:#4D4D5E;
    --softtext:#767688; --rule:#E4E4EC; --accent:#3B2FB8; --accentsoft:#E9E7FA;
    --sans:"IBM Plex Sans",-apple-system,"Segoe UI",sans-serif;
    --serif:"Newsreader",Georgia,serif; --mono:"IBM Plex Mono",Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(120% 90% at 50% 0%,var(--stage) 0%,var(--stage2) 100%);font-family:var(--sans);color:#E7E7F0;min-height:100vh}
  .page{max-width:1200px;margin:0 auto;padding:30px 18px 70px;display:flex;flex-direction:column;gap:24px}
  header{display:flex;flex-direction:column;gap:9px}
  .kick{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7C7C90}
  h1{font-family:var(--serif);font-size:clamp(28px,4.4vw,40px);font-weight:600;letter-spacing:-.02em;margin:0;color:#F2F2F8}
  .sub{color:#9C9CB0;font-size:15px;margin:0;max-width:72ch}
  .sub b{color:#DCDCE8}

  .layout{display:flex;gap:34px;flex-wrap:wrap;align-items:flex-start;justify-content:center}

  .phone{width:390px;height:800px;background:#08080C;border-radius:46px;padding:11px;box-shadow:0 0 0 2px #2B2B38,0 26px 60px -18px rgba(0,0,0,.9);flex:none;position:relative}
  .screen{width:100%;height:100%;background:var(--bg);border-radius:36px;overflow:hidden;display:flex;flex-direction:column;color:var(--ink);position:relative}

  .status{height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 26px;font-size:12.5px;font-weight:600;flex:none}
  .appbar{padding:2px 16px 9px;display:flex;flex-direction:column;gap:9px;flex:none;background:var(--bg)}
  .titlerow{display:flex;align-items:center;gap:10px}
  .apptitle{font-family:var(--serif);font-size:25px;font-weight:600;letter-spacing:-.02em;flex:1}
  .viewbtn{appearance:none;border:1px solid var(--rule);background:var(--surface);color:var(--mid);font:600 12px var(--sans);padding:7px 11px;border-radius:9px;cursor:pointer;display:flex;align-items:center;gap:5px}
  .viewbtn:active{background:var(--sunk)}
  .chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
  .chips::-webkit-scrollbar{display:none}
  .chip{flex:none;font:600 12.5px var(--sans);padding:7px 13px;border-radius:999px;background:var(--sunk);color:var(--mid);border:1px solid transparent;cursor:pointer}
  .chip[aria-pressed="true"]{background:var(--ink);color:#fff;border-color:var(--ink)}
  .count{font-size:12.5px;color:var(--softtext)}

  .list{flex:1;overflow-y:auto;padding-bottom:18px}
  .list::-webkit-scrollbar{width:0}

  .rowA{display:flex;gap:11px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--rule);background:var(--surface);cursor:pointer}
  .rowA:active{background:var(--sunk)}
  .thumbS{width:64px;height:40px;border-radius:6px;background:var(--sunk);flex:none;overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center}
  .thumbS img{width:100%;height:100%;object-fit:cover}
  .thumbS .ph{font-size:15px;opacity:.4}
  .thumbS .pl{position:absolute;color:#fff;font-size:13px;text-shadow:0 1px 6px rgba(0,0,0,.85)}
  .rowA .t{flex:1;min-width:0}
  .rowA .name{font-weight:600;font-size:15px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .plats{display:flex;gap:5px;align-items:center;margin-top:3px;flex-wrap:wrap}
  .pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;padding:2px 7px 2px 5px;border-radius:999px;background:var(--sunk);color:var(--mid);white-space:nowrap}
  .pill i{width:7px;height:7px;border-radius:50%;display:block;flex:none}
  .when{font-family:var(--mono);font-size:11px;color:var(--softtext);flex:none;text-align:right}

  .ghead{display:flex;align-items:center;gap:8px;padding:14px 16px 7px;background:var(--bg);position:sticky;top:0;z-index:1}
  .ghead i{width:10px;height:10px;border-radius:50%}
  .ghead b{font-size:13.5px;font-weight:700}
  .ghead span{font-size:12px;color:var(--softtext);margin-left:auto;font-family:var(--mono)}
  .thead{padding:15px 16px 7px;font:600 11.5px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--softtext);background:var(--bg);position:sticky;top:0;z-index:1}

  .rowD{display:flex;gap:13px;padding:13px 16px;border-bottom:1px solid var(--rule);background:var(--surface)}
  .thumbP{width:78px;height:104px;border-radius:8px;background:var(--sunk);flex:none;overflow:hidden;display:flex;align-items:center;justify-content:center}
  .thumbP img{width:100%;height:100%;object-fit:cover}
  .rowD .t{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
  .rowD .name{font-family:var(--serif);font-size:19px;font-weight:600;line-height:1.15}
  .rowD .credit{font-size:12.5px;color:var(--softtext)}
  .rowD .cta{margin-top:auto;font-size:12.5px;font-weight:600;color:var(--accent)}

  .empty{padding:44px 22px;text-align:center;color:var(--softtext);font-size:14px;line-height:1.6}

  .tabbar{height:58px;flex:none;display:flex;border-top:1px solid var(--rule);background:var(--surface)}
  .tabbar div{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:10.5px;color:var(--softtext);font-weight:600}
  .tabbar div.on{color:var(--accent)}
  .tabbar em{font-style:normal;font-size:16px}

  /* bottom sheet for the view picker */
  .scrim{position:absolute;inset:0;background:rgba(10,10,16,.45);opacity:0;pointer-events:none;transition:opacity .18s;border-radius:36px;z-index:5}
  .scrim.open{opacity:1;pointer-events:auto}
  .sheet{position:absolute;left:0;right:0;bottom:0;background:var(--surface);border-radius:20px 20px 36px 36px;padding:10px 12px 22px;transform:translateY(102%);transition:transform .22s cubic-bezier(.2,.8,.2,1);z-index:6}
  .sheet.open{transform:translateY(0)}
  .grab{width:38px;height:4px;border-radius:2px;background:var(--rule);margin:4px auto 10px}
  .sheet h3{margin:0 8px 8px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--softtext)}
  .opt{display:flex;gap:12px;align-items:center;padding:12px 10px;border-radius:12px;cursor:pointer}
  .opt:active{background:var(--sunk)}
  .opt .ic{width:38px;height:38px;border-radius:10px;background:var(--sunk);display:flex;align-items:center;justify-content:center;flex:none;font-size:17px}
  .opt .txt{flex:1}
  .opt .txt b{display:block;font-size:14.5px;font-weight:600}
  .opt .txt span{font-size:12.5px;color:var(--softtext)}
  .opt .tick{color:var(--accent);font-weight:700;font-size:16px;opacity:0}
  .opt[aria-selected="true"] .tick{opacity:1}
  .opt[aria-selected="true"] .ic{background:var(--accentsoft);color:var(--accent)}

  .picker{position:absolute;left:0;right:0;bottom:0;background:var(--surface);border-radius:20px 20px 36px 36px;padding:10px 12px 20px;transform:translateY(102%);transition:transform .22s cubic-bezier(.2,.8,.2,1);z-index:7;max-height:82%;display:flex;flex-direction:column}
  .picker.open{transform:translateY(0)}
  .picker h3{margin:0 8px 4px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--softtext)}
  .picker .hint{margin:0 8px 10px;font-size:12.5px;color:var(--softtext)}
  .search{display:flex;align-items:center;gap:8px;background:var(--sunk);border-radius:10px;padding:0 12px;margin:0 8px 10px}
  .search input{flex:1;border:0;background:transparent;outline:none;font:400 15px var(--sans);color:var(--ink);padding:11px 0}
  .langlist{overflow-y:auto;flex-shrink:1}
  .langopt{display:flex;align-items:center;gap:12px;padding:12px 10px;border-radius:12px;cursor:pointer}
  .langopt:active{background:var(--sunk)}
  .box{width:22px;height:22px;border-radius:6px;border:2px solid var(--rule);display:flex;align-items:center;justify-content:center;flex:none;font-size:13px;font-weight:800;color:transparent}
  .langopt[aria-checked="true"] .box{background:var(--accent);border-color:var(--accent);color:#fff}
  .donebtn{appearance:none;border:0;background:var(--accent);color:#fff;font:700 15px var(--sans);padding:14px;border-radius:10px;margin:10px 8px 0;cursor:pointer}
  .notes{background:#1A1A24;border:1px solid #2A2A38;border-radius:12px;padding:22px;display:flex;flex-direction:column;gap:12px;max-width:520px}
  .notes h2{font-family:var(--serif);font-size:21px;margin:0;color:#F0F0F6;font-weight:600}
  .notes ul{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:9px}
  .notes li{font-size:14px;color:#A8A8BC;line-height:1.55}
  .notes b{color:#E4E4EE}
  .notes .tip{background:#221F3E;border-left:3px solid #8B80F0;border-radius:8px;padding:13px 15px;font-size:13.5px;color:#C3BEE8;line-height:1.55}
</style>

<div class="page">
  <header>
    <div class="kick">App mockup &middot; real data &middot; all four views shipping</div>
    <h1>Streaming, the easy way</h1>
    <p class="sub">Pick a language, pick a period, read the list. All four layouts ship as a choice under <b>View</b> in the app bar &mdash; but the default works without anyone opening it.</p>
  </header>

  <div class="layout">
    <div class="phone">
      <div class="screen">
        <div class="status"><span>9:41</span><span>&#9679;&#9679;&#9679;&#9679;</span></div>
        <div class="appbar">
          <div class="titlerow">
            <div class="apptitle">What&rsquo;s streaming</div>
            <button class="viewbtn" id="viewbtn" type="button">&#9776; View</button>
          </div>
          <div class="chips" id="langrow"></div>
          <div class="chips" id="winrow"></div>
          <div class="count" id="count"></div>
        </div>
        <div class="list" id="list"></div>
        <div class="tabbar">
          <div class="on"><em>&#9635;</em>Browse</div>
          <div><em>&#9734;</em>Watchlist</div>
          <div><em>&#9650;</em>Coming</div>
          <div><em>&#9673;</em>You</div>
        </div>

        <div class="scrim" id="scrim"></div>
        <div class="picker" id="picker">
          <div class="grab"></div>
          <h3>My languages</h3>
          <p class="hint">Pick the ones you watch. They stay in this order.</p>
          <div class="search"><span style="color:var(--softtext)">&#9906;</span><input id="langsearch" type="text" placeholder="Search languages"></div>
          <div class="langlist" id="langlist"></div>
          <button class="donebtn" id="langdone" type="button">Done</button>
        </div>
        <div class="sheet" id="sheet">
          <div class="grab"></div>
          <h3>How to show the list</h3>
          <div id="opts"></div>
        </div>
      </div>
    </div>

    <div class="notes">
      <h2>Notes on the design</h2>
      <ul>
        <li><b>Default is "By date".</b> Compact rows grouped into this week, this month, earlier. It answers "what just landed" with no configuration, and it makes the period chips optional rather than load-bearing.</li>
        <li><b>All four are there</b> under View, and the choice is remembered. Compact for scanning, By platform for "what's new on what I pay for", By date as the default, Posters for browsing.</li>
        <li><b>Language is the first filter, always visible.</b> Not buried in settings, because it is the thing people change most and the thing that changes the answer most.</li>
        <li><b>One row per film, platforms as pills.</b> A film on three platforms is still one row, so the list length matches the number of films rather than the number of deals.</li>
      </ul>
      <div class="tip">
        <b>Try this:</b> switch the language from Telugu to Hindi. Kalki 2898 AD moves from Prime Video to Netflix and RRR moves from ZEE5 to Netflix &mdash; because that is genuinely what happened. An app with one platform per film would be wrong for both.
      </div>
    </div>
  </div>
</div>

<script>
  var RECORDS = ${json};
  var LANGS = ['Telugu','Hindi','Tamil','Malayalam','Kannada'];
  // Everything present in the data, plus a realistic wider set so the search
  // box can be judged against the long list it will really face.
  var ALL_LANGS = (function(){
    var seen = {};
    RECORDS.forEach(function(r){ r.rows.forEach(function(w){ if(w.language && w.language !== 'Unknown') seen[w.language]=1; }); });
    ['Bengali','Marathi','Punjabi','Gujarati','Odia','Assamese','Bhojpuri','Urdu','English',
     'Spanish','French','German','Japanese','Korean','Mandarin','Portuguese','Arabic','Turkish',
     'Italian','Russian','Thai','Vietnamese','Indonesian','Persian','Hebrew','Polish','Dutch'
    ].forEach(function(l){ seen[l]=1; });
    return Object.keys(seen).sort();
  })();
  var WINDOWS = [
    { id:'week',  label:'This week',  days:7 },
    { id:'month', label:'This month', days:31 },
    { id:'year',  label:'This year',  days:365 },
    { id:'all',   label:'All time',   days:1e9 }
  ];
  var VIEWS = [
    { id:'date',     icon:'\\u2637', name:'By date',     desc:'Newest first, grouped by week' },
    { id:'compact',  icon:'\\u2261', name:'Compact',     desc:'One flat list, most per screen' },
    { id:'platform', icon:'\\u25F0', name:'By platform', desc:'Grouped by streaming service' },
    { id:'poster',   icon:'\\u25A6', name:'Posters',     desc:'Bigger art, cast and director' }
  ];

  // The sample is historical, so windows are measured from the newest record
  // rather than today — otherwise everything but "All time" would be empty.
  var newest = 0;
  RECORDS.forEach(function(r){ r.rows.forEach(function(w){ if(w.date){ var t=Date.parse(w.date); if(t>newest) newest=t; } }); });

  var state = { lang:'Telugu', mine: LANGS.slice(0,3), win: WINDOWS[3], view: 'date' };
  try { var saved = localStorage.getItem('viewPref'); if(saved) state.view = saved; } catch(e){}

  function visibleRows(rec){
    return rec.rows.filter(function(row){
      if(row.language !== state.lang && row.language !== 'Unknown') return false;
      if(!row.date) return state.win.id === 'all';
      return (newest - Date.parse(row.date)) / 86400000 <= state.win.days;
    });
  }
  function fmt(iso){
    if(!iso) return 'date unknown';
    return new Date(iso+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit',timeZone:'UTC'});
  }
  function pill(r){ return '<span class="pill"><i style="background:'+r.color+'"></i>'+r.short+'</span>'; }
  function latest(rows){ var d = rows.map(function(r){return r.date;}).filter(Boolean).sort(); return d[d.length-1]; }

  function thumbS(rec){
    return rec.thumb
      ? '<div class="thumbS"><img src="'+rec.thumb+'" alt=""><span class="pl">&#9654;</span></div>'
      : '<div class="thumbS"><span class="ph">&#127916;</span></div>';
  }
  function thumbP(rec){
    return rec.thumb
      ? '<div class="thumbP"><img src="'+rec.thumb+'" alt=""></div>'
      : '<div class="thumbP"><span class="ph">&#127916;</span></div>';
  }

  function rowCompact(rec, rows){
    return '<div class="rowA">'+thumbS(rec)+
      '<div class="t"><div class="name">'+rec.title+'</div><div class="plats">'+rows.map(pill).join('')+'</div></div>'+
      '<div class="when">'+fmt(latest(rows))+'</div></div>';
  }
  function rowPoster(rec, rows){
    return '<div class="rowD">'+thumbP(rec)+
      '<div class="t"><div class="name">'+rec.title+'</div>'+
      '<div class="credit">'+(rec.director?'dir. '+rec.director:'')+(rec.cast.length?' \\u00b7 '+rec.cast.join(', '):'')+'</div>'+
      '<div class="plats">'+rows.map(pill).join('')+'</div>'+
      '<div class="cta">Streaming '+fmt(latest(rows))+(rec.hasTrailer?' \\u00b7 Trailer':'')+'</div></div></div>';
  }

  function build(){
    var items = RECORDS.map(function(rec){ return { rec:rec, rows:visibleRows(rec) }; })
                       .filter(function(x){ return x.rows.length > 0; });

    if(items.length === 0){
      return '<div class="empty">Nothing in '+state.lang+' for this period.<br>Try a wider period.</div>';
    }

    if(state.view === 'compact') return items.map(function(x){ return rowCompact(x.rec, x.rows); }).join('');
    if(state.view === 'poster')  return items.map(function(x){ return rowPoster(x.rec, x.rows); }).join('');

    if(state.view === 'platform'){
      var by = {};
      items.forEach(function(x){ x.rows.forEach(function(row){
        if(!by[row.platform]) by[row.platform] = { color:row.color, short:row.short, entries:[] };
        by[row.platform].entries.push({ rec:x.rec, rows:[row] });
      }); });
      return Object.keys(by).sort().map(function(p){
        var g = by[p];
        return '<div class="ghead"><i style="background:'+g.color+'"></i><b>'+g.short+'</b><span>'+g.entries.length+'</span></div>'+
               g.entries.map(function(e){ return rowCompact(e.rec, e.rows); }).join('');
      }).join('');
    }

    var buckets = [
      { label:'This week', max:7, items:[] },
      { label:'This month', max:31, items:[] },
      { label:'Earlier this year', max:365, items:[] },
      { label:'Older', max:1e9, items:[] }
    ];
    items.forEach(function(x){
      var d = latest(x.rows);
      var age = d ? (newest - Date.parse(d))/86400000 : 1e9;
      for(var i=0;i<buckets.length;i++){ if(age <= buckets[i].max){ buckets[i].items.push(x); break; } }
    });
    return buckets.filter(function(b){ return b.items.length; }).map(function(b){
      return '<div class="thead">'+b.label+'</div>'+b.items.map(function(x){ return rowCompact(x.rec, x.rows); }).join('');
    }).join('');
  }

  var listEl = document.getElementById('list');
  var countEl = document.getElementById('count');
  var langRow = document.getElementById('langrow');
  var winRow = document.getElementById('winrow');
  var optsEl = document.getElementById('opts');

  function paint(){
    listEl.innerHTML = build();
    listEl.scrollTop = 0;
    var n = RECORDS.filter(function(r){ return visibleRows(r).length; }).length;
    var viewName = VIEWS.filter(function(v){ return v.id === state.view; })[0].name;
    countEl.textContent = n + (n===1?' film':' films') + ' \\u00b7 ' + state.lang + ' \\u00b7 ' + viewName;

    // The period chips are a filter in every view; in "By date" the sections
    // already convey recency, so the chips stay but read as narrowing.
    winRow.hidden = false;

    Array.prototype.forEach.call(langRow.children, function(b){
      b.setAttribute('aria-pressed', String(b.classList.contains('lang') && b.textContent === state.lang));
    });
    Array.prototype.forEach.call(winRow.children, function(b){ b.setAttribute('aria-pressed', String(b.textContent === state.win.label)); });
    Array.prototype.forEach.call(optsEl.children, function(o){ o.setAttribute('aria-selected', String(o.dataset.view === state.view)); });
  }

  // Picker first, then the chosen languages — matching the app after testing
  // on device showed a combined "all mine" chip read as clutter.
  var pickBtn = document.createElement('button');
  pickBtn.className='chip'; pickBtn.type='button'; pickBtn.textContent='＋ Languages';
  pickBtn.onclick=function(){ openPicker(); };
  langRow.appendChild(pickBtn);

  function renderLangChips(){
    while(langRow.children.length > 1) langRow.removeChild(langRow.lastChild);
    state.mine.forEach(function(l){
      var b = document.createElement('button');
      b.className='chip lang'; b.type='button'; b.textContent=l;
      b.onclick=function(){ state.lang=l; paint(); };
      langRow.appendChild(b);
    });
  }
  WINDOWS.forEach(function(w){
    var b = document.createElement('button');
    b.className='chip'; b.type='button'; b.textContent=w.label;
    b.onclick=function(){ state.win=w; paint(); };
    winRow.appendChild(b);
  });
  VIEWS.forEach(function(v){
    var d = document.createElement('div');
    d.className='opt'; d.dataset.view=v.id; d.setAttribute('role','option');
    d.innerHTML='<div class="ic">'+v.icon+'</div><div class="txt"><b>'+v.name+'</b><span>'+v.desc+'</span></div><div class="tick">&#10003;</div>';
    d.onclick=function(){
      state.view=v.id;
      try { localStorage.setItem('viewPref', v.id); } catch(e){}
      closeSheet(); paint();
    };
    optsEl.appendChild(d);
  });

  // ---- language picker ----
  var picker=document.getElementById('picker');
  var langList=document.getElementById('langlist');
  var langSearch=document.getElementById('langsearch');

  function renderLangList(){
    var q=(langSearch.value||'').trim().toLowerCase();
    var matches=q?ALL_LANGS.filter(function(l){return l.toLowerCase().indexOf(q)>-1;}):ALL_LANGS;
    // Chosen first, so removing one never means hunting for it.
    var chosen=matches.filter(function(l){return state.mine.indexOf(l)>-1;});
    var rest=matches.filter(function(l){return state.mine.indexOf(l)===-1;});
    var list=chosen.concat(rest);
    langList.innerHTML = list.length===0
      ? '<p class="hint" style="text-align:center;padding:26px 0">No language matches that search.</p>'
      : list.map(function(l){
          var on=state.mine.indexOf(l)>-1;
          return '<div class="langopt" role="checkbox" aria-checked="'+on+'" data-lang="'+l+'">'+
                 '<div class="box">&#10003;</div><div style="flex:1;font-weight:'+(on?'600':'400')+'">'+l+'</div></div>';
        }).join('');
    Array.prototype.forEach.call(langList.querySelectorAll('.langopt'), function(el){
      el.onclick=function(){
        var l=el.dataset.lang, i=state.mine.indexOf(l);
        if(i>-1){ if(state.mine.length===1) return; state.mine.splice(i,1); if(state.lang===l) state.lang=state.mine[0]; }
        else state.mine.push(l);
        renderLangList(); renderLangChips(); paint();
      };
    });
  }
  function openPicker(){ langSearch.value=''; renderLangList(); picker.classList.add('open'); scrim.classList.add('open'); }
  function closePicker(){ picker.classList.remove('open'); scrim.classList.remove('open'); }
  langSearch.oninput=renderLangList;
  document.getElementById('langdone').onclick=closePicker;

  var sheet=document.getElementById('sheet'), scrim=document.getElementById('scrim');
  function openSheet(){ sheet.classList.add('open'); scrim.classList.add('open'); }
  function closeSheet(){ sheet.classList.remove('open'); scrim.classList.remove('open'); }
  document.getElementById('viewbtn').onclick=openSheet;
  scrim.onclick=function(){ closeSheet(); closePicker(); };

  renderLangChips();
  paint();
</script>
`;
}

const data = JSON.parse(readFileSync(resolve(HERE, process.argv[2] ?? 'data/sample.json'), 'utf8'));
const records = await buildRecords(data);
const out = resolve(HERE, 'mockup.html');
writeFileSync(out, render(records));
console.log(`Mockup with ${records.length} films written to ${out}`);
