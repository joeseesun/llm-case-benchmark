const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dbSource = fs.readFileSync(path.resolve(__dirname, '../lib/db.js'), 'utf8');

test('admin access has no built-in fallback password', () => {
  const start = dbSource.indexOf('function seedAdmin(');
  const end = dbSource.indexOf('\nfunction seedSecret(', start);
  const seedAdmin = dbSource.slice(start, end);
  assert.match(seedAdmin, /BENCHMARK_ADMIN_PASSWORD/);
  assert.doesNotMatch(seedAdmin, /\|\|\s*['"][^'"]+['"]/);
});
