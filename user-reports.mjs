/**
 * Pulls what people reported through the app's "Report a missing title" form
 * (OTTwalaWebsite /api/reports, admin key) into reports/user-reports.md.
 * Skips cleanly without PUSH_ADMIN_KEY.
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';

const KEY = process.env.PUSH_ADMIN_KEY;
if (!KEY) {
  console.log('No PUSH_ADMIN_KEY -- skipping user reports.');
  process.exit(0);
}
const r = await fetch('https://ottwala.usarajacreatortools.com/api/reports', { headers: { authorization: `Bearer ${KEY}` } });
if (!r.ok) {
  console.log(`reports fetch failed: ${r.status}`);
  process.exit(0);
}
const { reports } = await r.json();
const KIND = { missing: 'Missing title', wrong: 'Wrong platform/date', other: 'Other' };
const lines = [`# User reports - ${new Date().toISOString().slice(0, 10)}`, '', `${reports.length} reports, newest first.`, ''];
for (const x of reports) {
  const bits = [x.language, x.platform && `on ${x.platform}`, x.source].filter(Boolean).join(', ');
  lines.push(`- **${x.title}** - ${KIND[x.kind] ?? x.kind} (${x.at.slice(0, 10)}${bits ? '; ' + bits : ''})${x.note ? ' - ' + x.note : ''}`);
}
const md = lines.join('\n');
mkdirSync('reports', { recursive: true });
writeFileSync('reports/user-reports.md', md + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n' + md + '\n');
console.log(`${reports.length} user reports written.`);
