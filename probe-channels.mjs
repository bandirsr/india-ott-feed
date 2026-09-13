import { loadApiKey } from './src/youtube.js';
const key = loadApiKey();
const handles = ['aha','ETVWin','ZEE5','SonyLIV','JioHotstar','PrimeVideoIN','NetflixIndiaSouth','SunNXT'];
for (const h of handles) {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part','snippet,statistics');
  url.searchParams.set('forHandle','@'+h);
  url.searchParams.set('key',key);
  try {
    const res = await fetch(url);
    if(!res.ok){ console.log(h.padEnd(20)+'HTTP '+res.status); continue; }
    const j = await res.json();
    const it=(j.items||[])[0];
    if(!it){ console.log(h.padEnd(20)+'not found'); continue; }
    console.log(h.padEnd(20)+it.id.padEnd(26)+String(it.snippet.title).padEnd(28)+Number(it.statistics?.subscriberCount||0).toLocaleString()+' subs');
  } catch(e){ console.log(h.padEnd(20)+'ERR '+e.message); }
}
