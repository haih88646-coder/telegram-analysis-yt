import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncNow } from '../src/services/sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadLocalEnv() {
  for (const name of ['.env']) {
    const p = path.join(ROOT, name);
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}
loadLocalEnv();

const days = Number(process.argv[2] || 28);
try {
  const summary = await syncNow({ days });
  console.log('Sync complete:', JSON.stringify(summary, null, 2));
} catch (err) {
  console.error('Sync failed:', err?.message || err);
  process.exit(1);
}
