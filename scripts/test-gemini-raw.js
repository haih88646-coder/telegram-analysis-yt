import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let apiKey = process.env.GEMINI_API_KEY || '';
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*GEMINI_API_KEY\s*=\s*(.*)\s*$/.exec(line);
  if (m) apiKey = m[1].replace(/^["']|["']$/g, '');
}
console.log(`Key length: ${apiKey.length}, starts with: ${apiKey.slice(0, 6)}...`);

const host = 'https://generativelanguage.googleapis.com';
const t0 = Date.now();
try {
  const res = await fetch(`${host}/v1beta/models?key=${apiKey}`, { signal: AbortSignal.timeout(15000) });
  console.log(`MODELS LIST: HTTP ${res.status} (${Date.now() - t0}ms)`);
  const body = await res.json();
  if (body?.models) {
    const names = body.models.map((m) => String(m.name).replace('models/', ''));
    console.log(`Total models: ${names.length}`);
    console.log('Has gemini-3.8-flash:', names.some((n) => n.startsWith('gemini-3.8-flash')));
    console.log('Flash models available:', names.filter((n) => n.includes('flash')).slice(0, 12).join(', '));
  } else {
    console.log('Body:', JSON.stringify(body).slice(0, 500));
  }
} catch (err) {
  console.error(`CONNECTIVITY TEST FAILED after ${Date.now() - t0}ms:`, err?.name, err?.cause?.code || err?.code || '', String(err?.message || err).slice(0, 200));
}
