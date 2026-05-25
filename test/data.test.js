const test = require('node:test');
const assert = require('node:assert/strict');

const {
  blankProjectData,
  deriveProjectTitle,
  normalizeProjectData,
  projectPayload,
  projectSummary,
} = require('../api/_lib/data');

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
  assert.equal(normalized.meta.clientName, '');
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
