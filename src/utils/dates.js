export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export function daysAgo(n) {
  return new Date(Date.now() - n * 86400000);
}

export function analyticsWindow(days = 28, latencyDays = 3) {
  return {
    startDate: isoDate(daysAgo(days + latencyDays)),
    endDate: isoDate(daysAgo(latencyDays))
  };
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export function todayIso() {
  return isoDate(new Date());
}

export function sumRange(rows, field, fromIso, toIso) {
  return rows
    .filter((r) => r.date >= fromIso && r.date <= toIso)
    .reduce((acc, r) => acc + Number(r[field] || 0), 0);
}

export function lastNDates(rows, n) {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  return sorted.slice(0, n).reverse();
}
