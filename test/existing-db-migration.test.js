'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const APP_PORT = 42983;

function waitFor(url, timeoutMs = 8000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) return resolve();
      } catch {}
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting for ${url}`));
      setTimeout(poll, 80);
    };
    poll();
  });
}

function startServer(databasePath) {
  return spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(APP_PORT),
      BENCHMARK_DB: databasePath,
      BENCHMARK_ADMIN_PASSWORD: 'migration-test-password',
      BENCHMARK_SECRET: 'migration-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
  });
}

test('existing databases repair output types produced by the legacy inference bug', async (t) => {
  const databasePath = `/tmp/llm-case-benchmark-migration-${process.pid}.sqlite`;
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {}
  }
  t.after(() => {
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {}
    }
  });

  const initial = startServer(databasePath);
  await waitFor(`http://127.0.0.1:${APP_PORT}/healthz`);
  await stopServer(initial);

  const database = new DatabaseSync(databasePath);
  database
    .prepare("UPDATE cases SET output_type = 'html' WHERE id IN ('write-product-launch', 'write-long-context-brief')")
    .run();
  database
    .prepare("UPDATE cases SET prompt = prompt || '\n\n管理员改写' WHERE id = 'write-long-context-brief'")
    .run();
  database.prepare("DELETE FROM meta WHERE key = 'migration_explicit_output_types_v1'").run();
  database.close();

  const upgraded = startServer(databasePath);
  t.after(() => upgraded.kill('SIGTERM'));
  await waitFor(`http://127.0.0.1:${APP_PORT}/healthz`);

  const canonicalResponse = await fetch(`http://127.0.0.1:${APP_PORT}/api/cases/write-product-launch`);
  assert.equal(canonicalResponse.status, 200);
  assert.equal((await canonicalResponse.json()).case.outputType, 'text');

  const editedResponse = await fetch(`http://127.0.0.1:${APP_PORT}/api/cases/write-long-context-brief`);
  assert.equal(editedResponse.status, 200);
  assert.equal((await editedResponse.json()).case.outputType, 'html');
});
