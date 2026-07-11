'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const APP_PORT = 42986;
const UPSTREAM_PORT = 42987;
const SSRF_APP_PORT = 42988;

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

async function jsonFetchAt(port, pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

function waitUntil(predicate, timeoutMs = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('Timed out waiting for condition'));
      setTimeout(poll, 20);
    };
    poll();
  });
}

test('only visitor calls using a site key consume the site run quota', async (t) => {
  let upstreamCalls = 0;
  let releaseHeldUpstream = null;
  const upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      upstreamCalls += 1;
      if (raw.includes('hold custom request')) {
        await new Promise((resolve) => { releaseHeldUpstream = resolve; });
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{ message: { content: `ok-${upstreamCalls}` }, finish_reason: 'stop' }],
        usage: { completion_tokens: 1 },
      }));
    });
  });
  await new Promise((resolve) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', resolve));
  t.after(() => {
    releaseHeldUpstream?.();
    upstream.close();
  });

  const databasePath = `/tmp/llm-case-benchmark-rate-limit-${process.pid}.sqlite`;
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
      BENCHMARK_ADMIN_PASSWORD: 'rate-limit-test-password',
      BENCHMARK_SECRET: 'rate-limit-test-secret',
      BENCHMARK_RUN_LIMIT_PER_HOUR: '1',
      BENCHMARK_CUSTOM_RUN_CONCURRENCY: '1',
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

  const login = await jsonFetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'rate-limit-test-password' }),
  });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie').split(';', 1)[0];

  const model = await jsonFetch('/api/admin/models', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      id: 'site-test',
      label: 'Site test',
      model: 'test-model',
      baseUrl: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
      apiKey: 'site-test-key',
      enabled: true,
      isPublic: true,
    }),
  });
  assert.equal(model.response.status, 200);

  const customPayload = {
    baseUrl: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
    apiKey: 'visitor-owned-key',
    model: 'test-model',
    prompt: 'custom key should not be limited',
  };
  for (let index = 0; index < 2; index += 1) {
    const custom = await jsonFetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(customPayload),
    });
    assert.equal(custom.response.status, 200);
    assert.equal(custom.response.headers.get('x-ratelimit-policy'), 'caller-key-exempt');
  }

  const heldCustom = jsonFetch('/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...customPayload, prompt: 'hold custom request' }),
  });
  await waitUntil(() => typeof releaseHeldUpstream === 'function');
  const concurrentCustom = await jsonFetch('/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(customPayload),
  });
  assert.equal(concurrentCustom.response.status, 429);
  assert.equal(concurrentCustom.body.code, 'caller_concurrency_limit');
  releaseHeldUpstream();
  releaseHeldUpstream = null;
  assert.equal((await heldCustom).response.status, 200);

  const sitePayload = { siteModelId: 'site-test', prompt: 'site key uses visitor quota' };
  const firstSite = await jsonFetch('/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sitePayload),
  });
  assert.equal(firstSite.response.status, 200);
  assert.equal(firstSite.response.headers.get('x-ratelimit-limit'), '1');

  const limitedSite = await jsonFetch('/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sitePayload),
  });
  assert.equal(limitedSite.response.status, 429);
  assert.equal(limitedSite.body.code, 'site_rate_limit');
  assert.match(limitedSite.body.error, /每个模型计 1 次/);
  assert.ok(Number(limitedSite.response.headers.get('retry-after')) > 0);

  const adminSite = await jsonFetch('/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(sitePayload),
  });
  assert.equal(adminSite.response.status, 200);
  assert.equal(adminSite.response.headers.get('x-ratelimit-policy'), 'admin-exempt');
  assert.equal(upstreamCalls, 5);
});

test('production rejects private and non-HTTP custom Base URLs', async (t) => {
  const databasePath = `/tmp/llm-case-benchmark-ssrf-${process.pid}.sqlite`;
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {}
  }
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(SSRF_APP_PORT),
      BENCHMARK_DB: databasePath,
      BENCHMARK_SECRET: 'ssrf-test-secret',
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
  await waitFor(`http://127.0.0.1:${SSRF_APP_PORT}/healthz`).catch((error) => {
    throw new Error(`${error.message}\n${stderr}`);
  });

  for (const baseUrl of ['http://127.0.0.1:1/v1', 'file:///etc']) {
    const blocked = await jsonFetchAt(SSRF_APP_PORT, '/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey: 'owned-key', model: 'model', prompt: 'test' }),
    });
    assert.equal(blocked.response.status, 400);
    assert.match(blocked.body.error, /Base URL|生产环境/);
  }

  const blockedList = await jsonFetchAt(SSRF_APP_PORT, '/api/list-models', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseUrl: 'http://169.254.169.254/latest', apiKey: 'owned-key' }),
  });
  assert.equal(blockedList.response.status, 400);
  assert.match(blockedList.body.error, /生产环境/);
});
