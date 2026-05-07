import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelative } from '../../public/recent-sessions.js';

const NOW = 1_700_000_000_000;

describe('formatRelative', () => {
  test('returns "たった今" within 60 seconds', () => {
    assert.equal(formatRelative(NOW - 5_000, NOW), 'たった今');
    assert.equal(formatRelative(NOW - 59_000, NOW), 'たった今');
  });

  test('returns "N分前" under 1 hour', () => {
    assert.equal(formatRelative(NOW - 60_000, NOW), '1分前');
    assert.equal(formatRelative(NOW - 5 * 60_000, NOW), '5分前');
    assert.equal(formatRelative(NOW - 59 * 60_000, NOW), '59分前');
  });

  test('returns "N時間前" under 24 hours', () => {
    assert.equal(formatRelative(NOW - 60 * 60_000, NOW), '1時間前');
    assert.equal(formatRelative(NOW - 5 * 60 * 60_000, NOW), '5時間前');
  });

  test('returns "N日前" under 7 days', () => {
    assert.equal(formatRelative(NOW - 24 * 60 * 60_000, NOW), '1日前');
    assert.equal(formatRelative(NOW - 5 * 24 * 60 * 60_000, NOW), '5日前');
  });

  test('returns "N週間前" under 4 weeks', () => {
    assert.equal(formatRelative(NOW - 7 * 24 * 60 * 60_000, NOW), '1週間前');
    assert.equal(formatRelative(NOW - 21 * 24 * 60 * 60_000, NOW), '3週間前');
  });

  test('falls back to locale date for older entries', () => {
    const result = formatRelative(NOW - 100 * 24 * 60 * 60_000, NOW);
    // locale-dependent, just assert that it's not a "前" suffix
    assert.ok(!result.endsWith('前'));
    assert.ok(result.length > 0);
  });

  test('handles future timestamps as "たった今" (clock skew)', () => {
    assert.equal(formatRelative(NOW + 5_000, NOW), 'たった今');
  });
});
