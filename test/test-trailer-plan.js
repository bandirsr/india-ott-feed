import { planOrder } from '../src/trailer-plan.js';

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed += 1;
  else {
    failed += 1;
    console.log(`  FAIL  ${name}`);
  }
};
const q = (lang, n) => Array.from({ length: n }, (_, i) => ({ id: `${lang}${i}`, lang }));
const count = (o, l) => o.filter((f) => f.lang === l).length;

{
  const o = planOrder(new Map([['te', q('te', 900)], ['ta', q('ta', 900)], ['hi', q('hi', 900)], ['ml', q('ml', 900)], ['kn', q('kn', 900)], ['bn', q('bn', 900)]]), 80);
  check('spends the whole budget', o.length === 80);
  check('Telugu gets the most, Bengali the least', count(o, 'te') > count(o, 'ta') && count(o, 'ta') > count(o, 'hi') && count(o, 'hi') > count(o, 'ml') && count(o, 'bn') < count(o, 'kn'));
  check('Telugu is about a third', count(o, 'te') >= 24 && count(o, 'te') <= 29);
  check('newest-first order kept within a language', o.filter((f) => f.lang === 'te').every((f, i) => f.id === `te${i}`));
}
{
  const o = planOrder(new Map([['te', q('te', 5)], ['ta', q('ta', 900)], ['hi', q('hi', 900)]]), 80);
  check('short queue passes its share on', o.length === 80 && count(o, 'te') === 5);
  check('spill goes to the heavier language first', count(o, 'ta') > count(o, 'hi'));
}
{
  const o = planOrder(new Map([['te', q('te', 3)], ['gu', q('gu', 0)]]), 80);
  check('never searches more than exists', o.length === 3);
}
console.log(`trailer-plan: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
