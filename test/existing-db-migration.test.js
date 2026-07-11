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

test('submission inference and existing databases preserve trustworthy output types', async (t) => {
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
  const submissionResponse = await fetch(`http://127.0.0.1:${APP_PORT}/api/case-submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '写一个纯 CSS 的 loading 动画，输出完整 HTML' }),
  });
  assert.equal(submissionResponse.status, 201);
  const submission = await submissionResponse.json();
  const explicitTextResponse = await fetch(`http://127.0.0.1:${APP_PORT}/api/case-submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: '分析这段 HTML 的可访问性并给出文字建议',
      category: 'frontend',
      outputType: 'text',
    }),
  });
  assert.equal(explicitTextResponse.status, 201);
  const explicitTextSubmission = await explicitTextResponse.json();

  const loginResponse = await fetch(`http://127.0.0.1:${APP_PORT}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'migration-test-password' }),
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get('set-cookie').split(';', 1)[0];
  const reviewResponse = await fetch(
    `http://127.0.0.1:${APP_PORT}/api/admin/submissions/${encodeURIComponent(submission.id)}/review`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ action: 'approve' }),
    }
  );
  assert.equal(reviewResponse.status, 200);
  const reviewed = await reviewResponse.json();
  const approvedCaseResponse = await fetch(
    `http://127.0.0.1:${APP_PORT}/api/cases/${encodeURIComponent(reviewed.caseId)}`
  );
  assert.equal(approvedCaseResponse.status, 200);
  assert.equal((await approvedCaseResponse.json()).case.outputType, 'html');
  await stopServer(initial);

  const database = new DatabaseSync(databasePath);
  assert.equal(
    database.prepare('SELECT output_type FROM case_submissions WHERE id = ?').get(submission.id).output_type,
    'html'
  );
  assert.equal(
    database.prepare('SELECT output_type FROM case_submissions WHERE id = ?').get(explicitTextSubmission.id)
      .output_type,
    'text'
  );
  database
    .prepare("UPDATE cases SET output_type = 'html' WHERE id IN ('write-product-launch', 'write-long-context-brief')")
    .run();
  database
    .prepare("UPDATE cases SET prompt = prompt || '\n\n管理员改写' WHERE id = 'write-long-context-brief'")
    .run();
  database
    .prepare(
      `INSERT INTO cases (
        id, category, title, summary, difficulty, tags_json, system_prompt, prompt,
        rubric_json, output_type, status, source, author, sort_order, created_at, updated_at
      ) VALUES (?, 'frontend', ?, '', 'medium', '[]', '', ?, '[]', 'text', 'published', 'community', '匿名', 1000, ?, ?)`
    )
    .run(
      'c_写一个纯-css-的-loading-动画-主题_mrdpyj6b',
      '旧投稿 HTML 题',
      '写一个纯 CSS 的 loading 动画，主题是擂台对决，输出完整 HTML',
      new Date().toISOString(),
      new Date().toISOString()
    );
  database
    .prepare(
      `INSERT INTO cases (
        id, category, title, summary, difficulty, tags_json, system_prompt, prompt,
        rubric_json, output_type, status, source, author, sort_order, created_at, updated_at
      ) VALUES (?, 'frontend', ?, '', 'medium', '[]', '', ?, '[]', 'text', 'published', 'community', '匿名', 1001, ?, ?)`
    )
    .run(
      'c_similar-html-case',
      '相似但非目标投稿',
      '写一个纯 CSS 的 loading 动画，主题是擂台对决，输出完整 HTML',
      new Date().toISOString(),
      new Date().toISOString()
    );
  database.prepare("DELETE FROM meta WHERE key = 'migration_explicit_output_types_v1'").run();
  database.prepare("DELETE FROM meta WHERE key = 'migration_community_artifact_output_v1'").run();
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

  const communityResponse = await fetch(
    `http://127.0.0.1:${APP_PORT}/api/cases/${encodeURIComponent('c_写一个纯-css-的-loading-动画-主题_mrdpyj6b')}`
  );
  assert.equal(communityResponse.status, 200);
  const migratedCommunityCase = (await communityResponse.json()).case;
  assert.equal(migratedCommunityCase.outputType, 'html');

  const similarCommunityResponse = await fetch(
    `http://127.0.0.1:${APP_PORT}/api/cases/${encodeURIComponent('c_similar-html-case')}`
  );
  assert.equal(similarCommunityResponse.status, 200);
  assert.equal((await similarCommunityResponse.json()).case.outputType, 'text');

  const submissionsResponse = await fetch(
    `http://127.0.0.1:${APP_PORT}/api/admin/submissions?status=all`,
    { headers: { cookie } }
  );
  assert.equal(submissionsResponse.status, 200);
  const submissions = (await submissionsResponse.json()).submissions;
  assert.equal(
    submissions.find((item) => item.id === explicitTextSubmission.id).outputType,
    'text'
  );

  await stopServer(upgraded);
  const restarted = startServer(databasePath);
  t.after(() => restarted.kill('SIGTERM'));
  await waitFor(`http://127.0.0.1:${APP_PORT}/healthz`);
  const restartedCommunityResponse = await fetch(
    `http://127.0.0.1:${APP_PORT}/api/cases/${encodeURIComponent('c_写一个纯-css-的-loading-动画-主题_mrdpyj6b')}`
  );
  assert.equal(restartedCommunityResponse.status, 200);
  const restartedCommunityCase = (await restartedCommunityResponse.json()).case;
  assert.equal(restartedCommunityCase.outputType, 'html');
  assert.equal(restartedCommunityCase.updatedAt, migratedCommunityCase.updatedAt);
});
