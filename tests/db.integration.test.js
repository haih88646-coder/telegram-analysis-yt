import test from 'node:test';
import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';

test('database integration (opt-in via TEST_DATABASE_URL)', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const sql = neon(process.env.TEST_DATABASE_URL);
  let table = 'probe_' + Date.now().toString(36);
  await sql.query(`CREATE TABLE IF NOT EXISTS ${table} (id text primary key, v int)`);
  try {
    await sql.query(`INSERT INTO ${table} (id, v) VALUES ($1, $2)`, ['a', 1]);
    const rows = await sql.query(`SELECT v FROM ${table} WHERE id = 'a'`);
    assert.equal(rows[0].v, 1);
    await sql.query(`INSERT INTO ${table} (id, v) VALUES ('a', 2) ON CONFLICT (id) DO UPDATE SET v = 2`);
    const rows2 = await sql.query(`SELECT v FROM ${table} WHERE id = 'a'`);
    assert.equal(rows2[0].v, 2);
  } finally {
    await sql.query(`DROP TABLE ${table}`);
  }
});
