'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const APP_PORT = 42882;
const UPSTREAM_PORT = 42881;

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

test('retries without temperature and recovers an empty stop response', async (t) => {
  let successfulCalls = 0;
  const upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      res.setHeader('content-type', 'application/json');
      if (Object.hasOwn(body, 'temperature')) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: 'temperature is deprecated for this model' } }));
        return;
      }
      successfulCalls += 1;
      if (successfulCalls === 1) {
        res.end(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }));
        return;
      }
      res.end(JSON.stringify({
        output: [{ content: [{ type: 'output_text', text: '兼容重试成功' }] }],
        choices: [{ finish_reason: 'stop' }],
        usage: { output_tokens: 6 },
      }));
    });
  });
  await new Promise((resolve) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', resolve));
  t.after(() => upstream.close());

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      BENCHMARK_DB: `/tmp/llm-case-benchmark-test-${process.pid}.sqlite`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  await waitFor(`http://127.0.0.1:${APP_PORT}/healthz`);

  const response = await fetch(`http://127.0.0.1:${APP_PORT}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseUrl: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
      apiKey: 'test-key',
      model: 'claude-sonnet-5',
      prompt: 'test',
      temperature: 0.7,
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.content, '兼容重试成功');
  assert.equal(successfulCalls, 2);

  const streamResponse = await fetch(`http://127.0.0.1:${APP_PORT}/api/run-stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseUrl: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
      apiKey: 'test-key',
      model: 'claude-opus-4-8',
      prompt: 'test',
      temperature: 0.7,
    }),
  });
  const events = (await streamResponse.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(streamResponse.status, 200);
  assert.equal(events.find((event) => event.type === 'done').data.content, '兼容重试成功');

  const historyWrite = await fetch(`http://127.0.0.1:${APP_PORT}/api/run-history`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      caseId: 'write-city-fable',
      prompt: '历史记录回归测试',
      results: [{ model: 'test-model', label: 'Test model', content: '测试正文' }],
    }),
  });
  assert.equal(historyWrite.status, 201);

  const historyRead = await fetch(`http://127.0.0.1:${APP_PORT}/api/run-history?limit=10`);
  const historyData = await historyRead.json();
  assert.equal(historyRead.status, 200);
  assert.equal(historyData.history.length, 1);
  assert.equal(historyData.history[0].prompt, '历史记录回归测试');
});
