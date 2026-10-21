export function fmtNum(n) {
  if (n === null || n === undefined || n === '') return '0';
  const x = Number(n);
  if (!Number.isFinite(x)) return '0';
  if (Math.abs(x) >= 1_000_000_000) return (x / 1_000_000_000).toFixed(1) + 'B';
  if (Math.abs(x) >= 1_000_000) return (x / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(x) >= 1_000) return (x / 1_000).toFixed(1) + 'K';
  return Math.round(x).toLocaleString('en-US');
}

export function fmtDuration(totalSeconds) {
  const s = Math.round(Number(totalSeconds) || 0);
  if (s <= 0) return '0s';
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  return `${sec}s`;
}

export function fmtDurationIso(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return null;
  const [, d, h, mm, s] = m.map((v) => (v ? parseInt(v, 10) : 0));
  return ((d || 0) * 86400) + ((h || 0) * 3600) + ((mm || 0) * 60) + (s || 0);
}

export function fmtPct(n) {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return 'n/a';
  const x = Number(n);
  return `${x.toFixed(1)}%`;
}

export function fmtDelta(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  const diff = c - p;
  const arrow = diff > 0 ? '+' : diff < 0 ? '' : '~ ';
  const base = p > 0 ? ` (${((diff / p) * 100).toFixed(1)}%)` : '';
  return `${arrow}${Math.round(diff).toLocaleString('en-US')}${base}`;
}

export function splitMessage(text, limit = 4000) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let current = '';
  for (const para of text.split('\n')) {
    if ((current + para + '\n').length > limit && current.length > 0) {
      chunks.push(current.trimEnd());
      current = '';
    }
    if (para.length > limit) {
      for (let i = 0; i < para.length; i += limit) chunks.push(para.slice(i, i + limit));
    } else {
      current += para + '\n';
    }
  }
  if (current.trim().length > 0) chunks.push(current.trimEnd());
  return chunks;
}

export function clip(text, max) {
  const t = String(text || '');
  return t.length > max ? t.slice(0, max - 1) + '\u2026' : t;
}

export function parseIsoDuration(iso) {
  return fmtDurationIso(iso);
}
