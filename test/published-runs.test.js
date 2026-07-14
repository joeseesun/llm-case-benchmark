'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const APP_PORT = 42982;
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
  const response = await fetch(`http://127.0.0.1:${APP_PORT}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

test('administrator explicitly publishes immutable featured run versions', async (t) => {
  const databasePath = `/tmp/llm-case-benchmark-published-runs-${process.pid}.sqlite`;
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
      BENCHMARK_ADMIN_PASSWORD: 'published-runs-test-password',
      BENCHMARK_SECRET: 'published-runs-test-secret',
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

  const caseResponse = await jsonFetch('/api/cases/write-city-fable');
  assert.equal(caseResponse.response.status, 200);
  const currentPrompt = caseResponse.body.case.prompt;
  const currentSystem = caseResponse.body.case.system;

  await t.test('explicit text output types override keyword-based inference', async () => {
    for (const caseId of ['write-product-launch', 'write-long-context-brief']) {
      const result = await jsonFetch(`/api/cases/${caseId}`);
      assert.equal(result.response.status, 200);
      assert.equal(result.body.case.outputType, 'text');
    }
  });

  await t.test('ready-only case listing is empty before any featured publication', async () => {
    const readyOnly = await jsonFetch('/api/cases?ready=only');
    assert.equal(readyOnly.response.status, 200);
    assert.deepEqual(readyOnly.body.cases, []);

    const allCases = await jsonFetch('/api/cases');
    assert.equal(allCases.response.status, 200);
    assert.equal(allCases.body.cases.length > 0, true);
    assert.equal(allCases.body.cases[0].publishedRunSummary, null);
  });

  await t.test('visitor run history never becomes an official result', async () => {
    const historyWrite = await jsonFetch('/api/run-history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        caseId: 'write-city-fable',
        prompt: currentPrompt,
        results: [{ model: 'visitor-model', content: 'visitor output' }],
      }),
    });
    assert.equal(historyWrite.response.status, 201);

    const publicRuns = await jsonFetch('/api/cases/write-city-fable/published-runs');
    assert.equal(publicRuns.response.status, 200);
    assert.equal(publicRuns.body.featuredRun, null);
    assert.deepEqual(publicRuns.body.history, []);
  });

  const publishBody = {
    prompt: currentPrompt,
    system: currentSystem,
    results: [
      {
        status: 'ok',
        model: 'model-a',
        label: 'Model A',
        providerName: 'Provider A',
        reportedModel: 'model-a-2026-07',
        content: 'first official output',
        latencyMs: 1234,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        outputType: 'text',
        scores: { accuracy: 8.5, style: 7 },
        parameters: {
          temperature: 0.2,
          maxTokens: 2048,
          topP: 0.9,
          seed: 42,
          disableThinking: false,
          apiKey: 'test-key-must-never-be-public',
        },
        apiKey: 'test-key-must-never-be-public',
        baseUrl: 'https://private-provider.invalid/v1',
      },
      {
        status: 'error',
        model: 'model-b',
        label: 'Model B',
        providerName: 'Provider B',
        error: 'upstream timeout',
        latencyMs: 30000,
        outputType: 'text',
      },
    ],
    runConfig: {
      temperature: 0.3,
      maxTokens: 4096,
      disableThinking: true,
      apiKey: 'test-key-must-never-be-public',
      baseUrl: 'https://private-provider.invalid/v1',
    },
    note: '首轮人工审核',
  };

  await t.test('publishing requires administrator authentication', async () => {
    const unauthorized = await jsonFetch('/api/admin/cases/write-city-fable/published-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(publishBody),
    });
    assert.equal(unauthorized.response.status, 401);
  });

  const login = await jsonFetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'published-runs-test-password' }),
  });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie').split(';', 1)[0];

  await t.test('published snapshots preserve an explicit text output type', async () => {
    const textCase = await jsonFetch('/api/cases/write-product-launch');
    const created = await jsonFetch('/api/admin/cases/write-product-launch/published-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        prompt: textCase.body.case.prompt,
        system: textCase.body.case.system,
        results: [{ status: 'ok', model: 'model-a', content: '<script>text result</script>', outputType: 'html' }],
      }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.publishedRun.outputType, 'text');
    assert.equal(created.body.publishedRun.results[0].outputType, 'text');
  });

  await t.test('HTML publications store the effective system and actual request parameters', async () => {
    const htmlCase = await jsonFetch('/api/cases/fe-pricing-page');
    const effectiveSystem = [HTML_OUTPUT_SYSTEM, htmlCase.body.case.system].filter(Boolean).join('\n\n');
    const created = await jsonFetch('/api/admin/cases/fe-pricing-page/published-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        prompt: htmlCase.body.case.prompt,
        system: effectiveSystem,
        results: [{
          status: 'ok',
          model: 'model-html',
          content: '<!doctype html><html><body>ok</body></html>',
          outputType: 'text',
          parameters: { temperature: 0.7, maxTokens: 8192 },
        }],
        runConfig: { temperature: 0.7, maxTokens: 8192 },
      }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.publishedRun.system, effectiveSystem);
    assert.equal(created.body.publishedRun.outputType, 'html');
    assert.equal(created.body.publishedRun.results[0].outputType, 'html');
    assert.deepEqual(created.body.publishedRun.results[0].parameters, { temperature: 0.7, maxTokens: 8192 });
    assert.deepEqual(created.body.publishedRun.runConfig, { temperature: 0.7, maxTokens: 8192 });
  });

  await t.test('publishing accepts nine selected model results while retaining a bounded payload', async () => {
    const target = await jsonFetch('/api/cases/write-long-context-brief');
    const results = Array.from({ length: 9 }, (_, index) => ({
      status: 'ok',
      model: `model-${index + 1}`,
      content: `official output ${index + 1}`,
    }));
    const created = await jsonFetch('/api/admin/cases/write-long-context-brief/published-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        prompt: target.body.case.prompt,
        system: target.body.case.system,
        results,
      }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.publishedRun.results.length, 9);

    const tooMany = await jsonFetch('/api/admin/cases/write-long-context-brief/published-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        prompt: target.body.case.prompt,
        system: target.body.case.system,
        results: Array.from({ length: 33 }, (_, index) => ({
          status: 'ok',
          model: `model-${index + 1}`,
          content: `official output ${index + 1}`,
        })),
      }),
    });
    assert.equal(tooMany.response.status, 400);
    assert.match(tooMany.body.error, /1–32/);
  });

  await t.test('publishing validates case, prompt, and at least one successful result', async () => {
    const headers = { 'content-type': 'application/json', cookie };
    const missingCase = await jsonFetch('/api/admin/cases/missing-case/published-runs', {
      method: 'POST', headers, body: JSON.stringify(publishBody),
    });
    assert.equal(missingCase.response.status, 404);

    const stalePrompt = await jsonFetch('/api/admin/cases/write-city-fable/published-runs', {
      method: 'POST', headers, body: JSON.stringify({ ...publishBody, prompt: 'stale prompt' }),
    });
    assert.equal(stalePrompt.response.status, 409);

    const missingSystem = await jsonFetch('/api/admin/cases/write-city-fable/published-runs', {
      method: 'POST', headers, body: JSON.stringify({ ...publishBody, system: undefined }),
    });
    assert.equal(missingSystem.response.status, 400);

    const noSuccess = await jsonFetch('/api/admin/cases/write-city-fable/published-runs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...publishBody,
        results: [{ status: 'error', model: 'model-a', error: 'failed' }],
      }),
    });
    assert.equal(noSuccess.response.status, 400);
  });

  let firstPublished;
  await t.test('first publication snapshots successes and failures without credentials', async () => {
    const created = await jsonFetch('/api/admin/cases/write-city-fable/published-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(publishBody),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.publishedRun.version, 1);
    assert.equal(created.body.publishedRun.results[0].status, 'ok');
    assert.deepEqual(created.body.publishedRun.results[0].scores, { accuracy: 8.5, style: 7 });
    assert.deepEqual(created.body.publishedRun.results[0].parameters, {
      temperature: 0.2,
      maxTokens: 2048,
      disableThinking: false,
      topP: 0.9,
      seed: 42,
    });
    assert.equal(created.body.publishedRun.results[1].status, 'error');
    assert.equal(created.body.publishedRun.results[1].error, 'upstream timeout');
    assert.deepEqual(created.body.publishedRun.runConfig, {
      temperature: 0.3,
      maxTokens: 4096,
      disableThinking: true,
    });
    assert.doesNotMatch(JSON.stringify(created.body), /test-key-must-never-be-public|private-provider/);

    const readyOnly = await jsonFetch('/api/cases?ready=only');
    const readyCase = readyOnly.body.cases.find((item) => item.id === 'write-city-fable');
    assert.deepEqual(readyCase.publishedRunSummary, {
      version: 1,
      publishedAt: created.body.publishedRun.publishedAt,
      successCount: 1,
      failureCount: 1,
      resultCount: 2,
      note: '首轮人工审核',
    });
    firstPublished = created.body.publishedRun;
  });

  await t.test('new publication becomes featured while the old version remains readable', async () => {
    const created = await jsonFetch('/api/admin/cases/write-city-fable/published-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        ...publishBody,
        results: [{ status: 'ok', model: 'model-c', label: 'Model C', content: 'second official output' }],
        note: '第二轮人工审核',
      }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.publishedRun.version, 2);

    const list = await jsonFetch('/api/cases/write-city-fable/published-runs?limit=20');
    assert.equal(list.response.status, 200);
    assert.equal(list.body.featuredRun.version, 2);
    assert.equal(list.body.featuredRun.results[0].content, 'second official output');
    assert.deepEqual(list.body.history.map((run) => run.version), [2, 1]);
    assert.equal(list.body.history[1].successfulResultCount, 1);
    assert.equal(list.body.history[1].resultCount, 2);
    assert.equal(Object.hasOwn(list.body.history[1], 'results'), false);
    assert.equal(Object.hasOwn(list.body.history[1], 'prompt'), false);

    const oldVersion = await jsonFetch('/api/cases/write-city-fable/published-runs/1');
    assert.equal(oldVersion.response.status, 200);
    assert.equal(oldVersion.body.publishedRun.id, firstPublished.id);
    assert.equal(oldVersion.body.publishedRun.results[0].content, 'first official output');
    assert.equal(oldVersion.body.publishedRun.isFeatured, false);

    const readyOnly = await jsonFetch('/api/cases?ready=only');
    const readyCase = readyOnly.body.cases.find((item) => item.id === 'write-city-fable');
    assert.equal(readyCase.publishedRunSummary.version, 2);
    assert.equal(readyCase.publishedRunSummary.successCount, 1);
    assert.equal(readyCase.publishedRunSummary.failureCount, 0);
  });
});
