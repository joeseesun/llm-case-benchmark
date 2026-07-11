'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const APP_PORT = 42985;
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const HTML_OUTPUT_SYSTEM =
  '只输出一个可直接放进 iframe 预览的完整 HTML 或 SVG。不要解释、不要 Markdown、不要代码围栏。若用户要求 SVG 动画，优先输出一个完整 <svg ...>...</svg>，包含必要的 <style>、<animate> 或 <animateTransform>，必须闭合所有标签。';

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
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

async function assertPreviewShell(pathname, marker) {
  const response = await fetch(`${BASE_URL}${pathname}`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy') || '', /connect-src 'none'/);
  assert.match(body, /<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="/);
  assert.doesNotMatch(body, /allow-same-origin|allow-popups|allow-forms|allow-top-navigation/);
  assert.equal((body.match(/<iframe\b/g) || []).length, 1);
  assert.match(body, new RegExp(marker));
  assert.doesNotMatch(body, /<script>parent\./);
}

test('persisted HTML results have stable sandboxed preview pages', async (t) => {
  const databasePath = `/tmp/llm-case-benchmark-shareable-previews-${process.pid}.sqlite`;
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
      BENCHMARK_ADMIN_PASSWORD: 'shareable-preview-password',
      BENCHMARK_SECRET: 'shareable-preview-secret',
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
  await waitFor(`${BASE_URL}/healthz`).catch((error) => {
    throw new Error(`${error.message}\n${stderr}`);
  });

  const modelHtml = '<!doctype html><html><head><title>Shared</title></head><body><main id="share-marker">share-marker</main><script>parent.document.body.dataset.escape="yes"</script></body></html>';
  const contribution = await jsonFetch('/api/contributions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      caseId: 'custom-share-preview',
      caseTitle: 'Share preview',
      category: 'frontend',
      prompt: 'render html',
      results: [{ model: 'model-a', label: 'Model A', content: modelHtml, outputType: 'html' }],
    }),
  });
  assert.equal(contribution.response.status, 201);
  await assertPreviewShell(`/preview/contribution/${encodeURIComponent(contribution.body.id)}/0`, 'share-marker');

  const history = await jsonFetch('/api/run-history', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      caseId: 'fe-pricing-page',
      prompt: 'render history html',
      results: [{ model: 'model-b', label: 'Model B', content: modelHtml, outputType: 'html' }],
    }),
  });
  assert.equal(history.response.status, 201);
  await assertPreviewShell(`/preview/history/${encodeURIComponent(history.body.id)}/0`, 'share-marker');

  const login = await jsonFetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'shareable-preview-password' }),
  });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie').split(';', 1)[0];
  const caseResponse = await jsonFetch('/api/cases/fe-pricing-page');
  const currentCase = caseResponse.body.case;
  const published = await jsonFetch('/api/admin/cases/fe-pricing-page/published-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      prompt: currentCase.prompt,
      system: [HTML_OUTPUT_SYSTEM, currentCase.system].filter(Boolean).join('\n\n'),
      results: [{ status: 'ok', model: 'model-c', label: 'Model C', content: modelHtml }],
    }),
  });
  assert.equal(published.response.status, 201);
  await assertPreviewShell('/preview/case/fe-pricing-page/1/0', 'share-marker');

  const unpublished = await jsonFetch('/api/admin/cases/fe-pricing-page', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ ...currentCase, status: 'draft' }),
  });
  assert.equal(unpublished.response.status, 200);
  const hiddenPreview = await fetch(`${BASE_URL}/preview/case/fe-pricing-page/1/0`);
  assert.equal(hiddenPreview.status, 404);

  const missing = await fetch(`${BASE_URL}/preview/contribution/${encodeURIComponent(contribution.body.id)}/99`);
  assert.equal(missing.status, 404);
});
