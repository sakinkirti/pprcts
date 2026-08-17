const BRIEFING_CADENCES = new Set(['off', 'daily', 'weekly']);
const BRIEFING_STALE_AFTER_MS = 30 * 60 * 1000;

function normalizeBriefingCadence(value, legacyEnabled = false) {
  const cadence = String(value || '').toLowerCase();
  if (BRIEFING_CADENCES.has(cadence)) return cadence;
  return legacyEnabled ? 'daily' : 'off';
}

function formatServerDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeBriefingTimezone(value) {
  const timezone = String(value || 'UTC');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'UTC';
  }
}

function getZonedDateTime(date = new Date(), timezone = 'UTC') {
  const normalizedTimezone = normalizeBriefingTimezone(timezone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizedTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDate = `${values.year}-${values.month}-${values.day}`;
  return {
    date: localDate,
    hour: Number(values.hour),
    minute: Number(values.minute),
    timezone: normalizedTimezone,
    weekday: new Date(`${localDate}T00:00:00Z`).getUTCDay(),
  };
}

function parseBriefingTime(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return { hour: 6, minute: 0 };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return { hour: 6, minute: 0 };
  return { hour, minute };
}

function daysBetweenIsoDates(earlierDate, laterDate) {
  const earlier = Date.parse(`${earlierDate}T00:00:00Z`);
  const later = Date.parse(`${laterDate}T00:00:00Z`);
  if (!Number.isFinite(earlier) || !Number.isFinite(later)) return Number.NaN;
  return Math.floor((later - earlier) / 86_400_000);
}

function shouldGenerateScheduledBriefing({ cadence, latestDate, today }) {
  const normalizedCadence = normalizeBriefingCadence(cadence);
  if (normalizedCadence === 'off') return false;
  if (!latestDate) return true;
  if (latestDate >= today) return false;
  if (normalizedCadence === 'daily') return true;
  return daysBetweenIsoDates(latestDate, today) >= 7;
}

function shouldRunSchedulerForUser({ now, timezone, cadence, scheduledTime, scheduledWeekday, lastRunDate }) {
  const normalizedCadence = normalizeBriefingCadence(cadence);
  if (normalizedCadence === 'off') return false;
  const local = getZonedDateTime(now, timezone);
  const schedule = parseBriefingTime(scheduledTime);
  const scheduledMinutes = schedule.hour * 60 + schedule.minute;
  const localMinutes = local.hour * 60 + local.minute;
  if (normalizedCadence === 'weekly' && local.weekday !== Number(scheduledWeekday)) return false;
  return localMinutes >= scheduledMinutes && lastRunDate !== local.date;
}

function isBriefingStale(briefing, now = Date.now(), staleAfterMs = BRIEFING_STALE_AFTER_MS) {
  if (briefing?.status !== 'generating') return false;
  const createdAt = Date.parse(briefing.created_at);
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(createdAt) || !Number.isFinite(currentTime)) return false;
  return currentTime - createdAt >= staleAfterMs;
}

module.exports = {
  BRIEFING_CADENCES,
  BRIEFING_STALE_AFTER_MS,
  daysBetweenIsoDates,
  formatServerDate,
  getZonedDateTime,
  isBriefingStale,
  normalizeBriefingCadence,
  normalizeBriefingTimezone,
  parseBriefingTime,
  shouldGenerateScheduledBriefing,
  shouldRunSchedulerForUser,
};
