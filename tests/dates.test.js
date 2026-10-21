import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsWindow, addDays, isoDate, daysAgo, sumRange, lastNDates } from '../src/utils/dates.js';

test('analyticsWindow respects latency', () => {
  const win = analyticsWindow(28);
  const today = isoDate(new Date());
  const endDate = isoDate(daysAgo(3));
  assert.equal(win.endDate, endDate);
  assert.notEqual(new Date(win.endDate + 'T00:00:00Z').getTime(), new Date(today + 'T00:00:00Z').getTime());
  const start = new Date(win.startDate + 'T00:00:00Z');
  const end = new Date(win.endDate + 'T00:00:00Z');
  const spanDays = Math.round((end - start) / 86400000);
  assert.equal(spanDays, 28);
});

test('window span for 7 days', () => {
  const win = analyticsWindow(7);
  const start = new Date(win.startDate + 'T00:00:00Z');
  const end = new Date(win.endDate + 'T00:00:00Z');
  assert.equal(Math.round((end - start) / 86400000), 7);
});

test('addDays across month boundary', () => {
  assert.equal(addDays('2026-01-30', 5), '2026-02-04');
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
});

test('sumRange sums only in-range rows', () => {
  const rows = [
    { date: '2026-10-01', views: 10 },
    { date: '2026-10-02', views: 20 },
    { date: '2026-10-03', views: 30 },
    { date: '2026-10-04', views: 40 }
  ];
  assert.equal(sumRange(rows, 'views', '2026-10-02', '2026-10-03'), 50);
  assert.equal(sumRange(rows, 'views', '2026-10-10', '2026-10-12'), 0);
});

test('lastNDates returns n earliest of latest', () => {
  const rows = [
    { date: '2026-10-01', views: 1 },
    { date: '2026-10-02', views: 2 },
    { date: '2026-10-03', views: 3 }
  ];
  const res = lastNDates(rows, 2);
  assert.deepEqual(res.map((r) => r.date), ['2026-10-02', '2026-10-03']);
});
