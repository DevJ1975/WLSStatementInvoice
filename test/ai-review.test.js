const assert = require('node:assert/strict');
const test = require('node:test');

const { buildChatPrompt, compactProjectForAi, deterministicPreflight, isReportReviewIntent, runClaudePreflight } = require('../api/_lib/ai-review');

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

test('deterministic preflight warns for receipt metadata mismatches', () => {
  const project = completeProject({
    receipts: [
      {
        id: 'receipt-1',
        expenseId: 'expense-1',
        vendor: 'Different Vendor',
        date: '2026-05-19',
        amount: 15,
        category: 'Supplies',
        imageFileId: 'file-1',
      },
    ],
  });
  const review = deterministicPreflight(project);
  const labels = review.warnings.map((item) => item.label).join('\n');

  assert.match(labels, /Expense row 1 amount does not match/);
  assert.match(labels, /Expense row 1 date does not match/);
  assert.match(labels, /Expense row 1 vendor does not match/);
  assert.match(labels, /Expense row 1 category does not match/);
});

test('deterministic preflight flags onsite work logs without same-day mileage', () => {
  const project = completeProject({
    mileageRows: [],
    workLogs: [{ id: 'work-1', date: '2026-05-18', taskCategory: 'Onsite work', hours: 8, status: 'Complete' }],
  });
  const review = deterministicPreflight(project);

  assert.ok(review.warnings.some((item) => item.label.includes('Work log row 1 has onsite/travel work but no mileage row')));
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

test('compact AI payload includes business rules, receipt matching, work-log coverage, and save state', () => {
  const payload = compactProjectForAi(
    completeProject(),
    { saveState: { storage: 'local', hasUnsavedChanges: true, status: 'cached' } }
  );

  assert.ok(payload.businessRules.some((rule) => rule.includes('Julie is advisory')));
  assert.equal(payload.saveState.storage, 'local');
  assert.equal(payload.saveState.hasUnsavedChanges, true);
  assert.equal(payload.expenses[0].receiptReference, 'Receipt row 1');
  assert.deepEqual(payload.expenses[0].receiptMatchStatus, ['matched']);
  assert.equal(payload.expenses[0].hasReceiptImage, true);
  assert.equal(payload.receipts[0].linkedExpenseRow, 1);
  assert.deepEqual(payload.receipts[0].matchStatus, ['matched']);
  assert.equal(payload.workLogs[0].hasMileageForDate, true);
});

test('Julie detects report-review chat intent', () => {
  assert.equal(isReportReviewIntent('Please check for errors'), true);
  assert.equal(isReportReviewIntent('review this report'), true);
  assert.equal(isReportReviewIntent('is this ready to send?'), true);
  assert.equal(isReportReviewIntent('what is wrong with mileage?'), true);
});

test('Julie report-review chat prompt stays focused on report data, not code', () => {
  const result = buildChatPrompt(completeProject(), [{ role: 'user', content: 'Please check for errors' }]);
  const serialized = JSON.stringify(result.prompt);

  assert.equal(result.reportReviewIntent, true);
  assert.equal(result.prompt.mode, 'report-review');
  assert.ok(result.prompt.responseFormat.includes('Needs attention'));
  assert.ok(result.prompt.responseFormat.includes('Next 3 actions'));
  assert.ok(serialized.includes('deterministicReview'));
  assert.ok(serialized.includes('compactProject'));
  assert.ok(serialized.includes('Do not provide code'));
  assert.ok(serialized.includes('Do not use Critical as a heading'));
  assert.ok(serialized.includes('Expense row'));
});

test('Julie normal report questions still use current project data', () => {
  const result = buildChatPrompt(completeProject(), [{ role: 'user', content: 'Why is total due this amount?' }]);
  const serialized = JSON.stringify(result.prompt);

  assert.equal(result.reportReviewIntent, false);
  assert.equal(result.prompt.mode, 'report-question');
  assert.ok(serialized.includes('totals'));
  assert.equal(result.prompt.compactProject.totals.totalDue, 2827.1);
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
