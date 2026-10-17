import { foldProviders } from '../src/providerfold.js';

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}`);
  }
};

const G = '#6E6E80';
const providers = {
  10: { name: 'Amazon Video', color: G },
  119: { name: 'Amazon Prime Video', color: '#00A8E1' },
  482: { name: 'ManoramaMax', color: '#1B998B' },
  2177: { name: 'ManoramaMAX', color: G },
  515: { name: 'MX Player', color: '#2ABF9E' },
  1898: { name: 'Amazon MX Player', color: '#00C3FF' },
  11: { name: 'MUBI', color: '#000000' },
  201: { name: 'MUBI', color: G },
  232: { name: 'Zee5', color: '#8230C6' },
};
const titles = [
  { id: 'a', p: [{ id: 2177, on: '2026-10-01', src: 'yt' }] },
  { id: 'b', p: [{ id: 482, on: null }, { id: 2177, on: '2026-09-30' }] },
  { id: 'c', p: [{ id: 1898, on: null }, { id: 10, on: null }] },
  { id: 'd', p: [{ id: 201, on: null }] },
];
const r = foldProviders(providers, titles);

check('ManoramaMAX folds into ManoramaMax', !r.providers[2177] && r.providers[482]?.name === 'ManoramaMax');
check('Amazon MX Player folds into MX Player', !r.providers[1898] && r.providers[515]?.name === 'MX Player');
check('duplicate MUBI keeps the branded id', !r.providers[201] && r.providers[11]);
check('Amazon Video is NOT merged into Prime', r.providers[10] && r.providers[119]);
check('single-spelling names are untouched', r.providers[232].name === 'Zee5');
check('title rows are re-pointed', titles[0].p[0].id === 482 && titles[2].p[0].id === 515 && titles[3].p[0].id === 11);
check('same service twice becomes one entry', titles[1].p.length === 1 && titles[1].p[0].id === 482);
check('earlier known date survives', titles[1].p[0].on === '2026-09-30');
check('rental entry kept as its own row', titles[2].p.some((e) => e.id === 10));
check('no dangling ids', titles.every((t) => t.p.every((e) => r.providers[e.id])));

console.log(`providerfold: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
