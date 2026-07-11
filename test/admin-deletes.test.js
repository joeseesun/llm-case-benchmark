'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const APP_PORT = 42984;

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

async function jsonFetch(pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${APP_PORT}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

async function createContribution(label) {
  return jsonFetch('/api/contributions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      caseId: `custom-${label}`,
      caseTitle: label,
      category: 'custom',
      prompt: `${label} prompt`,
      results: [{ model: 'test-model', label: 'Test model', content: `${label} output` }],
    }),
  });
}

async function createRunHistory(label) {
  return jsonFetch('/api/run-history', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      caseId: 'write-city-fable',
      prompt: `${label} prompt`,
      results: [{ model: 'test-model', label: 'Test model', content: `${label} output` }],
    }),
  });
}

test('administrators can delete contribution and run-history records', async (t) => {
  const databasePath = `/tmp/llm-case-benchmark-admin-deletes-${process.pid}.sqlite`;
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {}
  }

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(APP_PORT),
      BENCHMARK_DB: databasePath,
      BENCHMARK_ADMIN_PASSWORD: 'admin-deletes-test-password',
      BENCHMARK_SECRET: 'admin-deletes-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(() => {
    child.kill('SIGTERM');
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {}
    }
  });
  await waitFor(`http://127.0.0.1:${APP_PORT}/healthz`).catch((error) => {
    throw new Error(`${error.message}\n${stderr}`);
  });

  const contributionTarget = await createContribution('delete-contribution');
  const contributionSurvivor = await createContribution('keep-contribution');
  const historyTarget = await createRunHistory('delete-history');
  const historySurvivor = await createRunHistory('keep-history');
  for (const created of [contributionTarget, contributionSurvivor, historyTarget, historySurvivor]) {
    assert.equal(created.response.status, 201);
    assert.equal(typeof created.body.id, 'string');
  }

  const unauthorizedContribution = await jsonFetch(
    `/api/admin/contributions/${encodeURIComponent(contributionTarget.body.id)}`,
    { method: 'DELETE' }
  );
  assert.equal(unauthorizedContribution.response.status, 401);

  const unauthorizedHistory = await jsonFetch(
    `/api/admin/run-history/${encodeURIComponent(historyTarget.body.id)}`,
    { method: 'DELETE' }
  );
  assert.equal(unauthorizedHistory.response.status, 401);

  const login = await jsonFetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'admin-deletes-test-password' }),
  });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie').split(';', 1)[0];

  const deletedContribution = await jsonFetch(
    `/api/admin/contributions/${encodeURIComponent(contributionTarget.body.id)}`,
    { method: 'DELETE', headers: { cookie } }
  );
  assert.equal(deletedContribution.response.status, 200);
  assert.deepEqual(deletedContribution.body, { ok: true });

  const deletedHistory = await jsonFetch(
    `/api/admin/run-history/${encodeURIComponent(historyTarget.body.id)}`,
    { method: 'DELETE', headers: { cookie } }
  );
  assert.equal(deletedHistory.response.status, 200);
  assert.deepEqual(deletedHistory.body, { ok: true });

  const contributions = await jsonFetch('/api/contributions');
  assert.equal(contributions.response.status, 200);
  assert.equal(
    contributions.body.contributions.some((item) => item.id === contributionTarget.body.id),
    false
  );
  assert.equal(
    contributions.body.contributions.some((item) => item.id === contributionSurvivor.body.id),
    true
  );

  const history = await jsonFetch('/api/run-history?limit=100');
  assert.equal(history.response.status, 200);
  assert.equal(history.body.history.some((item) => item.id === historyTarget.body.id), false);
  assert.equal(history.body.history.some((item) => item.id === historySurvivor.body.id), true);

  const missingContribution = await jsonFetch(
    `/api/admin/contributions/${encodeURIComponent(contributionTarget.body.id)}`,
    { method: 'DELETE', headers: { cookie } }
  );
  assert.equal(missingContribution.response.status, 404);
  assert.equal(missingContribution.body.error, '分享记录不存在');

  const missingHistory = await jsonFetch(
    `/api/admin/run-history/${encodeURIComponent(historyTarget.body.id)}`,
    { method: 'DELETE', headers: { cookie } }
  );
  assert.equal(missingHistory.response.status, 404);
  assert.equal(missingHistory.body.error, '测试记录不存在');
});
