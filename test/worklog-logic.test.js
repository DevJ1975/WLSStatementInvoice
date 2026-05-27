const assert = require('node:assert/strict');
const test = require('node:test');

test('inferWorkTypeForDate uses onsite and remote statement ranges', async () => {
  const { inferWorkTypeForDate } = await import('../src/workLogLogic.mjs');
  const report = {
    onsiteFrom: '2026-05-11',
    onsiteTo: '2026-05-13',
    remoteFrom: '2026-05-14',
    remoteTo: '2026-05-15',
  };

  assert.equal(inferWorkTypeForDate('2026-05-12', report), 'Onsite work');
  assert.equal(inferWorkTypeForDate('2026-05-15', report), 'Remote work');
  assert.equal(inferWorkTypeForDate('2026-05-18', report, 'Travel/Admin'), 'Travel/Admin');
});

test('nextWeekdayInPeriod skips weekends and existing work log dates', async () => {
  const { nextWeekdayInPeriod } = await import('../src/workLogLogic.mjs');

  assert.equal(
    nextWeekdayInPeriod({
      afterDate: '2026-05-15',
      periodFrom: '2026-05-11',
      periodTo: '2026-05-22',
      existingDates: ['2026-05-18'],
      today: '2026-05-11',
    }),
    '2026-05-19',
  );
});

test('autoWorkLogSummary creates concise summaries for work types', async () => {
  const { autoWorkLogSummary } = await import('../src/workLogLogic.mjs');

  assert.equal(
    autoWorkLogSummary({ workType: 'Onsite work', clientSite: 'SNAK KING', location: 'City of Industry' }),
    'Onsite work completed for SNAK KING at City of Industry.',
  );
  assert.equal(
    autoWorkLogSummary({ workType: 'Remote work', clientSite: 'SNAK KING' }),
    'Remote support completed for SNAK KING.',
  );
  assert.equal(
    autoWorkLogSummary({ workType: 'Travel/Admin', clientSite: 'SNAK KING', notes: 'Booked travel.' }),
    'Travel/admin support completed for SNAK KING. Notes: Booked travel.',
  );
});
