import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateText, generateJson } from '../src/gemini/analyst.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

console.log('--- TEST 1: plain text request');
const t0 = Date.now();
try {
  const text = await generateText({ prompt: 'Reply with exactly: OK' });
  console.log(`PASS (${Date.now() - t0}ms):`, JSON.stringify(text.slice(0, 100)));
} catch (err) {
  console.error(`FAIL (${Date.now() - t0}ms):`, JSON.stringify({ name: err?.name, status: err?.status, message: String(err?.message).slice(0, 300) }));
}

console.log('\n--- TEST 2: structured JSON request');
const t1 = Date.now();
try {
  const obj = await generateJson({
    prompt: 'Give one rule with topic "test".',
    schema: { type: 'OBJECT', properties: { topic: { type: 'STRING' } }, required: ['topic'] }
  });
  console.log(`PASS (${Date.now() - t1}ms):`, JSON.stringify(obj));
} catch (err) {
  console.error(`FAIL (${Date.now() - t1}ms):`, JSON.stringify({ name: err?.name, status: err?.status, message: String(err?.message).slice(0, 300) }));
}
