export const workLogTypes = ['Onsite work', 'Remote work', 'Travel/Admin', 'Other'];
export const workLogStatuses = ['Draft', 'Complete', 'Needs review'];
export const workLogHourOptions = ['2', '4', '6', '8', '10', 'Custom'];

export function isValidDateInput(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

export function addDaysInput(value, days) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateInsideRange(date, from, to) {
  if (!isValidDateInput(date)) return true;
  if (isValidDateInput(from) && date < from) return false;
  if (isValidDateInput(to) && date > to) return false;
  return true;
}

export function dateIsWeekday(value) {
  if (!isValidDateInput(value)) return false;
  const day = new Date(`${value}T00:00:00`).getDay();
  return day !== 0 && day !== 6;
}

export function nextWeekdayInPeriod({
  afterDate = '',
  periodFrom = '',
  periodTo = '',
  existingDates = [],
  today = new Date().toISOString().slice(0, 10),
} = {}) {
  const usedDates = new Set(existingDates.filter(Boolean));
  let candidate = afterDate && isValidDateInput(afterDate) ? addDaysInput(afterDate, 1) : periodFrom || today;
  if (isValidDateInput(periodFrom) && candidate < periodFrom) candidate = periodFrom;
  for (let index = 0; index < 60; index += 1) {
    if (dateInsideRange(candidate, periodFrom, periodTo) && dateIsWeekday(candidate) && !usedDates.has(candidate)) return candidate;
    candidate = addDaysInput(candidate, 1);
  }
  return today;
}

export function inferWorkTypeForDate(date, report = {}, rememberedType = '') {
  if (dateInsideRange(date, report.onsiteFrom, report.onsiteTo) && report.onsiteFrom && report.onsiteTo) return 'Onsite work';
  if (dateInsideRange(date, report.remoteFrom, report.remoteTo) && report.remoteFrom && report.remoteTo) return 'Remote work';
  return workLogTypes.includes(rememberedType) ? rememberedType : 'Other';
}

export function workLogLocationForType(workType, meta = {}, defaults = {}) {
  if (workType === 'Remote work') return 'Remote';
  if (workType === 'Travel/Admin') return meta.siteName || defaults.siteName || 'Travel/Admin';
  return meta.siteName || meta.siteAddress || defaults.siteName || defaults.siteAddress || '';
}

export function autoWorkLogSummary({ workType = '', clientSite = '', location = '', notes = '' } = {}) {
  const client = clientSite || 'client/site';
  const place = location && location !== client ? ` at ${location}` : '';
  const noteText = notes ? ` Notes: ${notes}` : '';
  if (workType === 'Remote work') return `Remote support completed for ${client}.${noteText}`;
  if (workType === 'Travel/Admin') return `Travel/admin support completed for ${client}.${noteText}`;
  if (workType === 'Onsite work') return `Onsite work completed for ${client}${place}.${noteText}`;
  return `${workType || 'Work'} completed for ${client}${place}.${noteText}`;
}

export function datesForWeekdayRange(from, to) {
  if (!isValidDateInput(from) || !isValidDateInput(to)) return [];
  const dates = [];
  for (let cursor = from; cursor <= to; cursor = addDaysInput(cursor, 1)) {
    if (dateIsWeekday(cursor)) dates.push(cursor);
  }
  return dates;
}
