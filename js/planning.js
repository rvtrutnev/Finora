(function (root) {
  'use strict';
  const DEFAULT_DAYS = [10, 25];
  function normalizeDays(values) {
    const days = [...new Set((Array.isArray(values) ? values : [])
      .filter(d => Number.isInteger(d) && d >= 1 && d <= 31))].sort((a, b) => a - b);
    return days.length ? days : [...DEFAULT_DAYS];
  }
  function normalizeSchedule(values) {
    const entries = new Map();
    for (const value of Array.isArray(values) ? values : []) {
      const day = typeof value === 'number' ? value : value?.day;
      if (Number.isInteger(day) && day >= 1 && day <= 31) {
        entries.set(day, { day, moveWeekend: typeof value === 'number' ? false : value.moveWeekend === true });
      }
    }
    return entries.size ? [...entries.values()].sort((a, b) => a.day - b.day)
      : DEFAULT_DAYS.map(day => ({ day, moveWeekend: true }));
  }
  function period(values, now = new Date()) {
    const days = normalizeSchedule(values);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const candidates = [];
    for (let offset = -2; offset <= 2; offset++) {
      const last = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0).getDate();
      for (const { day, moveWeekend } of days) {
        const date = new Date(today.getFullYear(), today.getMonth() + offset, Math.min(day, last));
        if (moveWeekend && date.getDay() === 6) date.setDate(date.getDate() - 1);
        if (moveWeekend && date.getDay() === 0) date.setDate(date.getDate() - 2);
        candidates.push(date);
      }
    }
    candidates.sort((a, b) => a - b);
    const next = candidates.find(date => date > today);
    const previous = candidates.filter(date => date <= today).at(-1);
    const distance = (a, b) => (Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) -
      Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000;
    return { next, days: distance(next, today), length: distance(next, previous) };
  }
  function validPayment(p) {
    return p && typeof p.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(p.id) && typeof p.name === 'string' && p.name.trim().length > 0 &&
      p.name.length <= 100 && Number.isFinite(p.amount) && p.amount > 0 && p.amount <= 1e9 &&
      Number.isInteger(p.months) && p.months >= 2 && p.months <= 120 &&
      ['RUB', 'USD', 'EUR'].includes(p.currency) && /^\d{4}-(0[1-9]|1[0-2])$/.test(p.startMonth);
  }
  function payments(value) {
    return Array.isArray(value) ? value.filter(validPayment).map(p => ({
      id: p.id, name: p.name, amount: p.amount, months: p.months, currency: p.currency, startMonth: p.startMonth
    })) : [];
  }
  function reserves(value, month) {
    const totals = {};
    for (const payment of payments(value)) {
      if (payment.startMonth > month) continue;
      totals[payment.currency] = (totals[payment.currency] || 0) + payment.amount / payment.months;
    }
    return Object.fromEntries(Object.entries(totals).map(([currency, sum]) => [currency, Math.round((sum + Number.EPSILON) * 100) / 100]));
  }
  root.FinoraPlanning = { normalizeDays, normalizeSchedule, period, validPayment, payments, reserves };
})(window);
