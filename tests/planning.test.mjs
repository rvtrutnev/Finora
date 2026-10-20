import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const window = {};
vm.runInNewContext(fs.readFileSync(new URL('../js/planning.js', import.meta.url), 'utf8'), { window, Date });
const { period, reserves, normalizeDays, validPayment } = window.FinoraPlanning;
const payment = (overrides = {}) => ({ id: 'insurance', name: 'Страховка', amount: 12000, months: 12, currency: 'RUB', startMonth: '2026-10', ...overrides });
test('annual and half-year payments contribute their annual total divided by twelve', () => {
  assert.equal(reserves([payment(), payment({ id: 'school', amount: 60000, months: 6 })], '2026-10').RUB, 11000);
});
test('reserves respect start month, currencies and aggregate rounding', () => {
  const rows = [payment(), payment({ currency: 'USD', amount: 120 }), payment({ startMonth: '2026-12', amount: 120000 })];
  assert.equal(reserves(rows, '2026-09').RUB, undefined);
  assert.equal(reserves(rows, '2026-10').RUB, 1000);
  assert.equal(reserves(rows, '2026-10').USD, 10);
  assert.equal(reserves([payment({ amount: 100, months: 3 }), payment({ amount: 100, months: 3 })], '2026-10').RUB, 66.67);
});
test('invalid financial inputs are excluded', () => {
  for (const overrides of [{ amount: -1 }, { amount: Infinity }, { months: 1 }, { months: 2.5 }, { name: '' }, { currency: 'XYZ' }, { startMonth: '2026-13' }]) {
    assert.equal(validPayment(payment(overrides)), false);
  }
});
test('dates are unique, sorted and bounded', () => {
  assert.equal(normalizeDays([20, 5, 5, 32, 0, 3.5]).join(','), '5,20');
  assert.equal(normalizeDays(null).join(','), '10,25');
});
test('next date excludes today and crosses year boundaries', () => {
  const p = period([5, 20], new Date(2026, 9, 20));
  assert.equal(p.next.getMonth(), 10);
  assert.equal(p.next.getDate(), 5);
  assert.equal(p.days, 16);
  assert.equal(p.length, 16);
  assert.equal(period([5], new Date(2026, 11, 30)).next.getFullYear(), 2027);
});
test('short months clamp 31 and handle leap years without zero-length periods', () => {
  assert.equal(period([31], new Date(2027, 1, 1)).next.getDate(), 28);
  assert.equal(period([31], new Date(2028, 1, 1)).next.getDate(), 29);
  const p = period([28, 30, 31], new Date(2027, 1, 28));
  assert.equal(p.next.getMonth(), 2);
  assert.equal(p.next.getDate(), 28);
  assert.ok(p.length > 0);
});
test('weekend shifting is independent for each date and crosses month boundaries', () => {
  const schedule = [{ day: 10, moveWeekend: false }, { day: 25, moveWeekend: true }];
  assert.equal(period(schedule, new Date(2026, 9, 1)).next.getDate(), 10);
  assert.equal(period(schedule, new Date(2026, 9, 11)).next.getDate(), 23);
  const p = period([{ day: 1, moveWeekend: true }], new Date(2026, 6, 30));
  assert.equal(p.next.getMonth(), 6);
  assert.equal(p.next.getDate(), 31);
  assert.equal(p.days, 1);
  assert.equal(period([{ day: 1, moveWeekend: true }], new Date(2026, 6, 31)).next.getMonth(), 8);
});
test('coincident shifted dates do not create zero-day periods and defaults preserve old rules', () => {
  assert.equal(period(null, new Date(2026, 9, 1)).next.getDate(), 9);
  const p = period([{ day: 24, moveWeekend: true }, { day: 25, moveWeekend: true }], new Date(2026, 9, 23));
  assert.equal(p.next.getDate(), 24);
  assert.equal(p.next.getMonth(), 10);
  assert.equal(p.length, 32);
});
