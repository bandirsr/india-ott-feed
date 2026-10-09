import { needsCheck } from '../src/digital.js';
import { reportedDay } from '../src/fresh.js';

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}`);
  }
};

const today = '2026-10-03';

// needsCheck: what gets asked of TMDB again
check('never-checked title is asked', needsCheck(undefined, '2026-08-01', today));
check('title with a digital date is never asked again', !needsCheck({ g: '2026-09-01', c: '2026-09-02' }, '2026-08-01', today));
check('recent film with no date, checked yesterday, waits', !needsCheck({ g: null, c: '2026-10-02' }, '2026-09-20', today));
check('recent film with no date, checked 8 days ago, is asked again', needsCheck({ g: null, c: '2026-09-25' }, '2026-09-20', today));
check('old film with no date is left alone', !needsCheck({ g: null, c: '2026-01-01' }, '2025-01-01', today));
check('undated film with no digital date is still asked weekly', needsCheck({ g: null, c: '2026-09-01' }, null, today));

// reportedDay: Romanchakam's shape, cinema date mentioned in the article
check(
  'a date earlier than the article (the cinema release) is ignored',
  reportedDay({ date: '2026-09-02', publishedAt: '2026-10-01T06:00:00Z' }) === '2026-10-01'
);
// RSS timestamps are not ISO: the old slice(0, 10) produced "Tue, 06 Oc"
check(
  'an RSS timestamp becomes a real ISO day',
  reportedDay({ date: null, publishedAt: 'Tue, 06 Oct 2026 13:46:36 +0000' }) === '2026-10-06'
);
check(
  'an RSS timestamp in firstSeenAt becomes a real ISO day too',
  reportedDay({ date: null, firstSeenAt: 'Fri, 25 Sep 2026 22:15:00 +0000', publishedAt: null }) === '2026-09-25'
);
check(
  'an announced date after an RSS-dated article is kept',
  reportedDay({ date: '2026-10-10', publishedAt: 'Tue, 06 Oct 2026 13:46:36 +0000' }) === '2026-10-10'
);
check(
  'a cinema date before an RSS-dated article is ignored',
  reportedDay({ date: '2026-09-02', publishedAt: 'Tue, 06 Oct 2026 13:46:36 +0000' }) === '2026-10-06'
);
check('an announced later date is kept', reportedDay({ date: '2026-10-10', publishedAt: '2026-10-05T06:00:00Z' }) === '2026-10-10');
check('no date in the text falls back to the publish day', reportedDay({ date: null, publishedAt: '2026-10-01T23:30:00Z' }) === '2026-10-01');
check('firstSeenAt wins over publishedAt', reportedDay({ date: null, firstSeenAt: '2026-10-01T03:00:00Z', publishedAt: '2026-10-02T03:00:00Z' }) === '2026-10-01');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
