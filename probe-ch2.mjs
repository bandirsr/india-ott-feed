import { loadApiKey } from './src/youtube.js';
const key = loadApiKey();
for (const q of ['aha video telugu official','ETV Win official','Zee5 Telugu','Sun NXT Telugu']) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part','snippet'); url.searchParams.set('q',q);
  url.searchParams.set('type','channel'); url.searchParams.set('maxResults','3'); url.searchParams.set('key',key);
  const res = await fetch(url);
  if(!res.ok){ console.log(q+' -> HTTP '+res.status); continue; }
  const j = await res.json();
  console.log('=== '+q);
  for(const it of (j.items||[])) console.log('   '+String(it.snippet.channelId).padEnd(26)+it.snippet.channelTitle);
}
