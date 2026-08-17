const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatServerDate,
  getZonedDateTime,
  isBriefingStale,
  normalizeBriefingCadence,
  shouldGenerateScheduledBriefing,
  shouldRunSchedulerForUser,
} = require('../briefing-schedule');

test('normalizeBriefingCadence preserves supported values and migrates the legacy flag', () => {
  assert.equal(normalizeBriefingCadence('daily'), 'daily');
  assert.equal(normalizeBriefingCadence('weekly'), 'weekly');
  assert.equal(normalizeBriefingCadence('unexpected', true), 'daily');
  assert.equal(normalizeBriefingCadence(null, false), 'off');
});

test('daily briefings are due on the next calendar day', () => {
  assert.equal(shouldGenerateScheduledBriefing({ cadence: 'daily', latestDate: null, today: '2026-08-17' }), true);
  assert.equal(shouldGenerateScheduledBriefing({ cadence: 'daily', latestDate: '2026-08-17', today: '2026-08-17' }), false);
  assert.equal(shouldGenerateScheduledBriefing({ cadence: 'daily', latestDate: '2026-08-16', today: '2026-08-17' }), true);
});

test('weekly briefings are due after seven calendar days', () => {
  assert.equal(shouldGenerateScheduledBriefing({ cadence: 'weekly', latestDate: '2026-08-11', today: '2026-08-17' }), false);
  assert.equal(shouldGenerateScheduledBriefing({ cadence: 'weekly', latestDate: '2026-08-10', today: '2026-08-17' }), true);
  assert.equal(shouldGenerateScheduledBriefing({ cadence: 'off', latestDate: null, today: '2026-08-17' }), false);
});

test('scheduler evaluates 6 AM in each user timezone and handles daylight saving time', () => {
  const beforeNewYorkWindow = new Date('2026-08-17T09:59:00Z');
  const afterNewYorkWindow = new Date('2026-08-17T10:01:00Z');
  assert.deepEqual(getZonedDateTime(afterNewYorkWindow, 'America/New_York'), {
    date: '2026-08-17',
    hour: 6,
    minute: 1,
    timezone: 'America/New_York',
    weekday: 1,
  });
  assert.equal(shouldRunSchedulerForUser({ now: beforeNewYorkWindow, timezone: 'America/New_York', cadence: 'daily', scheduledTime: '06:00', lastRunDate: null }), false);
  assert.equal(shouldRunSchedulerForUser({ now: afterNewYorkWindow, timezone: 'America/New_York', cadence: 'daily', scheduledTime: '06:00', lastRunDate: null }), true);
  assert.equal(shouldRunSchedulerForUser({ now: afterNewYorkWindow, timezone: 'America/New_York', cadence: 'daily', scheduledTime: '06:00', lastRunDate: '2026-08-17' }), false);
  assert.equal(formatServerDate(new Date(2026, 7, 17, 9, 30)), '2026-08-17');
});

test('weekly scheduler only runs on the selected local weekday at or after the selected time', () => {
  const mondayAtNine = new Date('2026-08-17T13:00:00Z');
  assert.equal(shouldRunSchedulerForUser({ now: mondayAtNine, timezone: 'America/New_York', cadence: 'weekly', scheduledTime: '08:30', scheduledWeekday: 1, lastRunDate: null }), true);
  assert.equal(shouldRunSchedulerForUser({ now: mondayAtNine, timezone: 'America/New_York', cadence: 'weekly', scheduledTime: '09:30', scheduledWeekday: 1, lastRunDate: null }), false);
  assert.equal(shouldRunSchedulerForUser({ now: mondayAtNine, timezone: 'America/New_York', cadence: 'weekly', scheduledTime: '08:30', scheduledWeekday: 2, lastRunDate: null }), false);
});

test('generating briefings become stale after thirty minutes', () => {
  const now = new Date('2026-08-17T12:00:00Z');
  assert.equal(isBriefingStale({
    status: 'generating',
    created_at: '2026-08-17T11:29:59Z',
  }, now), true);
  assert.equal(isBriefingStale({
    status: 'generating',
    created_at: '2026-08-17T11:45:00Z',
  }, now), false);
  assert.equal(isBriefingStale({
    status: 'completed',
    created_at: '2026-08-17T10:00:00Z',
  }, now), false);
  assert.equal(isBriefingStale({ status: 'generating' }, now), false);
});
