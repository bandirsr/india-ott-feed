/**
 * A rights deal or an announcement is not "now streaming". Every headline below
 * is real. The first group went onto the app as a platform arrival when it was
 * only a story about a deal; the second group is genuine and must still count.
 *
 * Run: node test/test-announcements.js
 */
import { isAnnouncementOnly, extractFromItem } from '../src/fresh.js';

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  if (actual === expected) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}\n        expected ${expected}, got ${actual}`);
  }
}

const SRC = { id: 'test', name: 'Test' };

/* Deals and announcements: no date, nothing to report. */
const ANNOUNCEMENTS = [
  "Jailer 2 OTT Release Date and Platform : Rajinikanth's Latest Film to Stream on Amazon Prime Video After Theatrical Run",
  'Baththa Movie OTT Release Date and Platform Name – Netflix Secures Streaming Rights of Vijay Sethupathi’s Latest Film',
  'Netflix Bags Irandu Vaanam Digital Rights for a Whopping ₹26 Crore!',
  'Anbil Avan Movie OTT Release Date and Platform – SonyLIV Secures Streaming Rights, Meesaya Murukku 2 and Immortal Updates',
  'Dhoomakethu OTT Release Date – Netflix Secures Streaming Rights of Sajin Gopu and Nikhila Vimal Movie',
];
for (const h of ANNOUNCEMENTS) check(`announcement is dropped: ${h.slice(0, 40)}`, isAnnouncementOnly(h, false), true);

/* Genuine availability, however the sentence is built. */
const REAL = [
  'OTT: Sandeep Reddy-Backed Romanchakam Now Streaming on Netflix',
  'From Theatres to OTT in 3 Weeks: Karthi’s Sardar 2 Now Streaming on Amazon Prime Video',
  'OTT Alert: Mamitha Baiju’s Industry Hit Bethlehem Kudumba Unit Now Streaming on JioHotstar',
  'Sumanth’s Mahendragiri Varahi Arrives on OTT Just 3 Weeks After Theatrical Release',
  'Ravi Teja’s Blockbuster Irumudi Lands on Netflix in 5 Languages',
];
for (const h of REAL) check(`real availability is kept: ${h.slice(0, 40)}`, isAnnouncementOnly(h, false), false);

/* A dated announcement is an announced premiere and stays, as reportedDay documents. */
check('a deal headline with a date is kept', isAnnouncementOnly('Netflix to stream Foo from October 25', true), false);
check('a dated release line is kept', isAnnouncementOnly('Panchanama OTT Release: ZEE5 – September 11, 2026', true), false);

/* End to end: the Jailer 2 story produces no report at all. */
const jailer = extractFromItem(
  { title: ANNOUNCEMENTS[0], description: '', link: 'https://example.test/jailer-2', publishedAt: 'Fri, 16 Oct 2026 08:19:26 +0000' },
  SRC
);
check('Jailer 2 rights story yields no report', jailer.length, 0);

/* Hand-checked entries must carry everything the loader needs, or they are silently ignored. */
import { readFileSync } from 'node:fs';
const manual = JSON.parse(readFileSync(new URL('../data/manual-releases.json', import.meta.url), 'utf8'));
for (const m of manual) {
  const ok = m.title && m.platform && /^\d{4}-\d{2}-\d{2}$/.test(m.date ?? '') && Array.isArray(m.languages) && /^https?:\/\//.test(m.link ?? '');
  check(`manual entry is complete: ${m.title}`, Boolean(ok), true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
