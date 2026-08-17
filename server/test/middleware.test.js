const assert = require('node:assert/strict');
const test = require('node:test');
const {
  consumeDistributedRateLimit,
  corsAllowlist,
  getRateLimitKey,
  securityHeaders,
} = require('../security');

function responseDouble() {
  const headers = new Map();
  return {
    headers,
    statusCode: 200,
    body: null,
    set(nameOrObject, value) {
      if (typeof nameOrObject === 'object') {
        Object.entries(nameOrObject).forEach(([name, item]) => headers.set(name.toLowerCase(), item));
      } else headers.set(nameOrObject.toLowerCase(), value);
      return this;
    },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

test('securityHeaders sets defensive defaults and a request id', () => {
  const req = { get: () => undefined };
  const res = responseDouble();
  let called = false;
  securityHeaders(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  assert.ok(res.headers.get('x-request-id'));
});

test('securityHeaders rejects unsafe caller-supplied request ids', () => {
  const res = responseDouble();
  securityHeaders({ get: () => 'unsafe request id\nvalue' }, res, () => {});
  assert.notEqual(res.headers.get('x-request-id'), 'unsafe request id\nvalue');
  assert.match(res.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
});

test('rate limit identities are hashed before persistence', () => {
  process.env.RATE_LIMIT_HASH_SALT = 'test-rate-limit-secret';
  const key = getRateLimitKey('ai', 'user@example.com');
  assert.equal(key.length, 64);
  assert.equal(key.includes('user@example.com'), false);
});

test('consumeDistributedRateLimit normalizes the database response', async () => {
  const client = {
    async rpc(name, params) {
      assert.equal(name, 'consume_api_rate_limit');
      assert.deepEqual(params, { p_key: 'abc', p_window_seconds: 60, p_limit: 20 });
      return {
        data: [{
          is_allowed: true,
          remaining_requests: 19,
          resets_at: '2026-08-17T00:01:00.000Z',
        }],
        error: null,
      };
    },
  };
  const result = await consumeDistributedRateLimit(client, 'abc', 60_000, 20);
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 19);
  assert.equal(result.resetAt, Date.parse('2026-08-17T00:01:00.000Z'));
});

test('corsAllowlist accepts configured origins and rejects others', () => {
  process.env.ALLOWED_ORIGINS = 'https://app.example.com';
  const accepted = responseDouble();
  let called = false;
  corsAllowlist({ get: () => 'https://app.example.com', method: 'GET' }, accepted, () => { called = true; });
  assert.equal(called, true);
  assert.equal(accepted.headers.get('access-control-allow-origin'), 'https://app.example.com');

  const rejected = responseDouble();
  corsAllowlist({ get: () => 'https://evil.example', method: 'GET' }, rejected, () => {});
  assert.equal(rejected.statusCode, 403);
});
