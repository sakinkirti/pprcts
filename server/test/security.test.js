const assert = require('node:assert/strict');
const test = require('node:test');
const { isIsoDate } = require('../security');

test('isIsoDate accepts calendar dates and rejects malformed input', () => {
  assert.equal(isIsoDate('2026-08-16'), true);
  assert.equal(isIsoDate('08/16/2026'), false);
  assert.equal(isIsoDate(''), false);
});

