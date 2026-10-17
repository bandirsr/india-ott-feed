/**
 * Release announcements read from platform YouTube channels. Every title here
 * is a real upload from 2026-10-16; the point is that film announcements are
 * read and show/episode clips, banter and not-yet-due promos are not.
 *
 * Run: node test/test-ytplatform.js
 */
import { recordFromVideo, readTitle, parseTitleDate } from '../src/ytplatform.js';

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
  }
}

const AHA = { id: 'UCmO-jDLU-KUcweCzktuDsbg', name: 'aha videoIN', platform: 'aha', languages: ['Telugu', 'Tamil'] };
const HOT = { id: 'UC8lPjTzRiG37n1Q2kpz3Rfg', name: 'JioHotstar Tamil', platform: 'JioHotstar', languages: ['Tamil'] };
const TODAY = '2026-10-16';
const rec = (title, channel = AHA, posted = '2026-10-15T09:00:00Z') => recordFromVideo({ title, publishedAt: posted, videoId: 'abc' }, channel, TODAY);

/* Film announcements: the title comes out clean and the platform is the channel's. */
const FILMS = [
  ['Vasudheva Sutham - Watch Now | Master Mahendran | Vykunt Bonu | Mani Sharma', 'Vasudheva Sutham'],
  ['Magadheera Movie | Watch Now On Aha | Ram Charan | Kajal Aggarwal', 'Magadheera'],
  ['Yevadu Telugu Movie - Watch Now On Aha | Ram Charan | Allu Arjun', 'Yevadu'],
  ['Kotha Bangaru Lokam Movie Scenes - Watch Now On Aha | Varun Sandesh', 'Kotha Bangaru Lokam'],
  ['Love & Romance | Honeymoon Express Telugu Movie - Watch Now On Aha | H', 'Honeymoon Express'],
];
for (const [t, want] of FILMS) check(`aha film: ${want}`, rec(t)?.title, want);
check('JioHotstar "Title | Streaming Now on JioHotstar"', rec('VadaChennai | Streaming Now on JioHotstar', HOT)?.title, 'VadaChennai');
check('the record names the channel platform', rec(FILMS[0][0])?.platform, 'aha');
check('the record is language-strict for a language channel', rec(FILMS[0][0])?.strictLanguage, true);

/* Show clips, episodes, banter: never a film becoming available. */
const NOT_FILMS = [
  'Good News for Sammy | Batchmates | Streaming Now | JioHotstar | Hotstar Specials',
  'Hotstar Specials | HeartBeat Season 3 | Now Streaming | JioHotstar',
  'Part-Timers | Streaming Now | Week 8 | Promo 8 | JioHotstar',
  'Chef Mantra Project K S6 | Ep 6 | Suma | Nandini Reddy | Watch Now On Aha',
  'Value Zone - Chef Mantra Project K S6 | Suma | Nandini Reddy | Watch Now On Aha',
  'Sshhh Tamil Web Series - Watch Now On Aha | Srikanth | Sonia Agarwaal',
  'Weekend plans planned🫡😁 | Watch #DhoolpetPoliceStationMovie Streaming now on @ahatamil',
  'Killer yaaru?! | Watch #DhoolpetPoliceStationMovie Streaming now on @ahatamil',
  'Batchmates Wrap Up Mash-up | Batchmates Streaming Now | JioHotstar',
];
for (const t of NOT_FILMS) check(`not a film: ${t.slice(0, 44)}`, rec(t, t.includes('Batch') || t.includes('Hotstar') || t.includes('Part-') ? HOT : AHA), null);

/* Dated announcements: read, and only once the day has come. */
check('"Premieres On 9th October" is a dated announcement', rec('Maaremma Telugu Movie - Premieres On 9th October | Maadhav B', AHA, '2026-10-07T09:00:00Z')?.date, '2026-10-09');
check('its title is clean', rec('Maaremma Telugu Movie - Premieres On 9th October | Maadhav B', AHA, '2026-10-07T09:00:00Z')?.title, 'Maaremma');
check('a trailer with a premiere date is read', rec('SUGRIVA Telugu Movie Trailer - Premieres On 16th October On Aha | Balu', AHA, '2026-10-10T09:00:00Z')?.title, 'SUGRIVA');
check('a premiere that has not arrived yet is not reported', rec('Na Wife Missing | Premieres On Oct 22nd | Varun Sandesh | An Aha Original', AHA, '2026-10-09T09:00:00Z'), null);
check('the same promo is reported once its day has come',
  recordFromVideo({ title: 'Na Wife Missing | Premieres On Oct 22nd | Varun Sandesh', publishedAt: '2026-10-09T09:00:00Z', videoId: 'x' }, AHA, '2026-10-22')?.date, '2026-10-22');

/* "Watch Now" is catalogue (no arrival claimed); a dated premiere is a real arrival. */
check('Watch Now is flagged catalogue', rec(FILMS[1][0])?.catalog, true);
check('a dated premiere is not catalogue', rec('Maaremma Telugu Movie - Premieres On 9th October | Maadhav B', AHA, '2026-10-07T09:00:00Z')?.catalog, false);

/* The year comes from when it was posted. */
check('a late-year promo for early next year', parseTitleDate('X | Premieres On Jan 3rd', '2026-12-20'), '2027-01-03');
check('a day just before the post date stays this year', parseTitleDate('X | Premieres On Oct 9th', '2026-10-10'), '2026-10-09');

check('no signal, no record', readTitle('Nandini Reddy | Sree Vishnu | Aha Original'), null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
