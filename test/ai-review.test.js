const assert = require('node:assert/strict');
const test = require('node:test');

const { compactProjectForAi, deterministicPreflight, runClaudePreflight } = require('../api/_lib/ai-review');

function completeProject(overrides = {}) {
  return {
    id: 'project-1',
    title: 'Ready project',
    data: {
      meta: {
        clientName: 'Snak King',
        invoiceNumber: 'INV-101',
        siteName: 'Plant 1',
      },
      report: {
        employeeName: 'Jamil Jones',
        employeeId: '1234',
        reportDate: '2026-05-24',
        periodFrom: '2026-05-18',
        periodTo: '2026-05-22',
        onsiteFrom: '2026-05-18',
        onsiteTo: '2026-05-20',
        onsiteDays: 3,
        onsiteRate: 600,
        remoteFrom: '2026-05-21',
        remoteTo: '2026-05-22',
        remoteDays: 2,
        remoteRate: 500,
      },
      expenseRows: [
        {
          id: 'expense-1',
          receiptId: 'receipt-1',
          date: '2026-05-18',
          vendor: 'China Wok',
          description: 'Lunch',
          category: 'Meals',
          amount: 12.6,
        },
      ],
      receipts: [
        {
          id: 'receipt-1',
          expenseId: 'expense-1',
          vendor: 'China Wok',
          date: '2026-05-18',
          amount: 12.6,
          category: 'Meals',
          imageFileId: 'file-1',
          ocrText: 'receipt text',
        },
      ],
      mileageRows: [
        {
          id: 'mile-1',
          date: '2026-05-18',
          from: 'Home',
          to: 'Site',
          purpose: 'Travel to site',
          miles: 20,
          rate: 0.725,
        },
      ],
      workLogs: [
        {
          id: 'work-1',
          date: '2026-05-18',
          taskCategory: 'Onsite work',
          hours: 8,
          status: 'Complete',
          summary: 'Onsite work completed',
        },
      ],
      ...overrides,
    },
  };
}

test('deterministic preflight classifies critical missing report and receipt issues', () => {
  const review = deterministicPreflight({
    data: {
      meta: {},
      report: { periodFrom: '2026-05-18', periodTo: '2026-05-22' },
      expenseRows: [{ id: 'expense-1', date: '2026-05-18', vendor: 'Cafe', amount: 10 }],
      receipts: [],
      mileageRows: [],
      workLogs: [],
    },
  });

  assert.equal(review.status, 'fail');
  assert.ok(review.critical.some((item) => item.label.includes('Client name')));
  assert.ok(review.critical.some((item) => item.label.includes('accountant receipt evidence') || item.label.includes('missing receipt')));
});

test('deterministic preflight warns for draft work logs and date issues', () => {
  const project = completeProject({
    workLogs: [{ id: 'work-1', date: '2026-05-25', taskCategory: 'Remote work', hours: 8, status: 'Draft' }],
  });
  const review = deterministicPreflight(project);

  assert.equal(review.status, 'warning');
  assert.ok(review.warnings.some((item) => item.label.includes('Draft')));
  assert.ok(review.warnings.some((item) => item.label.includes('outside')));
});

test('deterministic preflight calculates package totals', () => {
  const review = deterministicPreflight(completeProject());

  assert.equal(review.totalsReview.laborTotal, 2800);
  assert.equal(review.totalsReview.expenseTotal, 12.6);
  assert.equal(review.totalsReview.mileageTotal, 14.5);
  assert.equal(review.totalsReview.totalDue, 2827.1);
});

test('compact AI payload redacts receipt images and limits OCR text', () => {
  const project = completeProject({
    receipts: [
      {
        id: 'receipt-1',
        expenseId: 'expense-1',
        imageFileId: 'file-1',
        imageUrl: 'data:image/jpeg;base64,secret',
        previewUrl: 'blob:secret',
        ocrText: 'x'.repeat(1000),
      },
    ],
  });
  const payload = compactProjectForAi(project);

  assert.equal(payload.receipts[0].hasImage, true);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.receipts[0], 'imageUrl'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.receipts[0], 'previewUrl'), false);
  assert.equal(payload.receipts[0].ocrText.length, 700);
});

test('Claude preflight reports setup error when API key is missing', async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    await assert.rejects(() => runClaudePreflight(completeProject()), {
      code: 'AI_SETUP_REQUIRED',
      message: 'Missing ANTHROPIC_API_KEY environment variable.',
    });
  } finally {
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
  }
});
