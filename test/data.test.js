const test = require('node:test');
const assert = require('node:assert/strict');

const {
  blankProjectData,
  defaultEntryValues,
  deriveProjectTitle,
  inferReceiptCategory,
  normalizeProjectData,
  projectPayload,
  projectReviewChecklist,
  projectSummary,
  suggestNextSequence,
  weekdayCountInRange,
} = require('../api/_lib/data');
const { isProjectStatus } = require('../api/_lib/project-status');

test('normalizeProjectData fills missing sections and preserves valid arrays', () => {
  const normalized = normalizeProjectData({
    report: {
      employeeName: 'Jamil Jones',
      reportNo: '35-SK',
    },
    expenseRows: [{ id: 'expense-1', amount: 42 }],
    mileageRows: 'not an array',
    receipts: [{ id: 'receipt-1' }],
  });

  assert.equal(normalized.report.employeeName, 'Jamil Jones');
  assert.equal(normalized.report.reportNo, '35-SK');
  assert.equal(normalized.report.phone, '');
  assert.equal(normalized.report.onsiteDescription, 'Onsite work');
  assert.equal(normalized.report.remoteDescription, 'Remote work');
  assert.equal(normalized.meta.clientName, '');
  assert.equal(normalized.meta.siteAddress, '');
  assert.deepEqual(normalized.expenseRows, [{ id: 'expense-1', amount: 42 }]);
  assert.deepEqual(normalized.mileageRows, []);
  assert.deepEqual(normalized.workLogs, []);
  assert.deepEqual(normalized.receipts, [{ id: 'receipt-1' }]);
});

test('blankProjectData returns independent report and collection objects', () => {
  const first = blankProjectData();
  const second = blankProjectData();

  first.report.employeeName = 'Changed';
  first.meta.clientName = 'Changed Client';
  first.expenseRows.push({ id: 'expense-1' });

  assert.equal(second.report.employeeName, '');
  assert.equal(second.meta.clientName, '');
  assert.equal(second.meta.siteAddress, '');
  assert.deepEqual(second.expenseRows, []);
});

test('deriveProjectTitle prefers explicit title, then report details, then default', () => {
  assert.equal(deriveProjectTitle({ title: 'Custom Project', data: {} }), 'Custom Project');

  assert.equal(
    deriveProjectTitle({
      data: {
        report: {
          reportNo: '35-SK',
          employeeName: 'Jamil Jones',
          periodFrom: '2026-05-01',
          periodTo: '2026-05-24',
        },
      },
    }),
    'Report 35-SK - Jamil Jones - 2026-05-01 to 2026-05-24'
  );

  assert.equal(deriveProjectTitle({ data: {} }), 'Untitled expense project');
});

test('projectSummary and projectPayload expose normalized project fields', () => {
  const project = {
    _id: 'project-1',
    status: 'archived',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-24T00:00:00.000Z',
    data: {
      report: {
        reportNo: '35-SK',
        employeeName: 'Jamil Jones',
        periodFrom: '2026-05-01',
        periodTo: '2026-05-24',
      },
      expenseRows: [{ id: 'expense-1' }],
    },
  };

  assert.deepEqual(projectSummary(project), {
    id: 'project-1',
    siteId: 'default',
    memberId: '',
    createdBy: '',
    updatedBy: '',
    title: 'Report 35-SK - Jamil Jones - 2026-05-01 to 2026-05-24',
    status: 'archived',
    reportNo: '35-SK',
    employeeName: 'Jamil Jones',
    periodFrom: '2026-05-01',
    periodTo: '2026-05-24',
    updatedAt: '2026-05-24T00:00:00.000Z',
    createdAt: '2026-05-01T00:00:00.000Z',
  });

  const payload = projectPayload(project);
  assert.equal(payload.id, 'project-1');
  assert.equal(payload.data.meta.clientName, '');
  assert.deepEqual(payload.data.expenseRows, [{ id: 'expense-1' }]);
  assert.deepEqual(payload.data.mileageRows, []);
  assert.deepEqual(payload.data.workLogs, []);
  assert.deepEqual(payload.data.receipts, []);
});

test('weekdayCountInRange counts weekdays inclusively and skips weekends', () => {
  assert.equal(weekdayCountInRange('2026-05-11', '2026-05-15'), 5);
  assert.equal(weekdayCountInRange('2026-05-15', '2026-05-18'), 2);
  assert.equal(weekdayCountInRange('2026-05-16', '2026-05-16'), 0);
  assert.equal(weekdayCountInRange('2026-05-18', '2026-05-15'), 0);
});

test('project status validation accepts active archived and deleted', () => {
  assert.equal(isProjectStatus('active'), true);
  assert.equal(isProjectStatus('archived'), true);
  assert.equal(isProjectStatus('deleted'), true);
  assert.equal(isProjectStatus('purged'), false);
});

test('defaultEntryValues suggests next numbers and preserves device defaults', () => {
  const defaults = defaultEntryValues(
    [
      { data: { report: { reportNo: '009', employeeName: 'Jamil Jones' }, meta: { invoiceNumber: 'INV-099' } } },
      { data: { report: { reportNo: '010' }, meta: { invoiceNumber: 'INV-100' } } },
    ],
    { mileageRate: '0.700', siteAddress: '123 Site St' }
  );

  assert.equal(defaults.employeeName, 'Jamil Jones');
  assert.equal(defaults.reportNo, '011');
  assert.equal(defaults.invoiceNumber, 'INV-101');
  assert.equal(defaults.mileageRate, '0.700');
  assert.equal(defaults.siteAddress, '123 Site St');
  assert.equal(suggestNextSequence(['35-SK', '36-SK']), '37-SK');
});

test('inferReceiptCategory uses remembered vendor category before OCR fallback', () => {
  assert.equal(
    inferReceiptCategory('Shell', 'Misc.', { vendorCategories: { shell: 'Fuel' } }),
    'Fuel'
  );
  assert.equal(inferReceiptCategory('Unknown Vendor', 'Meals', { vendorCategories: {} }), 'Meals');
});

test('projectReviewChecklist catches missing fields and date/day issues', () => {
  const items = projectReviewChecklist({
    meta: {},
    report: {
      periodFrom: '2026-05-11',
      periodTo: '2026-05-15',
      onsiteFrom: '2026-05-11',
      onsiteTo: '2026-05-15',
      onsiteDays: 4,
    },
    expenseRows: [{ id: 'expense-1', date: '2026-05-12', vendor: 'Hotel', amount: 10 }],
    workLogs: [{ id: 'work-1', date: '2026-05-18' }, { id: 'work-2', date: '2026-05-14' }],
    mileageRows: [{ id: 'mile-1', date: '2026-05-18' }],
    receipts: [],
  });

  assert.ok(items.some((item) => item.label === 'Client name is missing'));
  assert.ok(items.some((item) => item.label.includes('Expense missing receipt')));
  assert.ok(items.some((item) => item.label === 'Work log date outside period: 2026-05-18'));
  assert.ok(items.some((item) => item.label === 'Mileage date outside period: 2026-05-18'));
  assert.ok(items.some((item) => item.label === 'Work log has no mileage for 2026-05-14'));
  assert.ok(items.some((item) => item.label === 'Onsite day count is 4; weekday range is 5'));
});
