'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEEPSEEK_FLASH_MODEL,
  lockDeepSeekServerTarget,
} = require('../lib/db');

test('server-owned official DeepSeek targets are normalized to V4 Flash', () => {
  const target = lockDeepSeekServerTarget({
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    apiKey: 'server-owned-test-key',
  });
  assert.equal(target.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(target.model, DEEPSEEK_FLASH_MODEL);
});

test('non-DeepSeek caller-owned targets are not rewritten', () => {
  const target = lockDeepSeekServerTarget({
    baseUrl: 'https://gateway.example/v1',
    model: 'caller-model',
  });
  assert.equal(target.baseUrl, 'https://gateway.example/v1');
  assert.equal(target.model, 'caller-model');
});

test('official DeepSeek server targets reject insecure transport', () => {
  assert.throws(
    () => lockDeepSeekServerTarget({ baseUrl: 'http://api.deepseek.com', model: DEEPSEEK_FLASH_MODEL }),
    /只能请求 https:\/\/api\.deepseek\.com/
  );
});
