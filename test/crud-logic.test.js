const assert = require('node:assert/strict');
const test = require('node:test');

test('delete and undo restores a work log row exactly', async () => {
  const { deleteRowWithUndo, restoreUndoItems } = await import('../src/crudLogic.mjs');
  const data = {
    expenseRows: [],
    mileageRows: [],
    receipts: [],
    workLogs: [{ id: 'work-1', date: '2026-05-18', taskCategory: 'Onsite work', hours: 8, summary: 'Done', actions: 'Notes', status: 'Complete' }],
  };

  const removed = deleteRowWithUndo(data, 'workLogs', 'work-1', { label: 'Work log deleted.' });
  assert.deepEqual(removed.data.workLogs, []);
  assert.deepEqual(restoreUndoItems(removed.data, removed.undo).workLogs, data.workLogs);
});

test('replace work log date undo removes replacement and restores original', async () => {
  const { replaceRowsWithUndo, restoreUndoItems } = await import('../src/crudLogic.mjs');
  const data = {
    expenseRows: [],
    mileageRows: [],
    receipts: [],
    workLogs: [{ id: 'old', date: '2026-05-18', hours: 8 }],
  };
  const replacement = { id: 'new', date: '2026-05-18', hours: 10 };

  const result = replaceRowsWithUndo(data, 'workLogs', (row) => row.date === replacement.date, [replacement], 'Work log replaced.');
  assert.deepEqual(result.data.workLogs, [replacement]);
  assert.deepEqual(restoreUndoItems(result.data, result.undo).workLogs, data.workLogs);
});

test('expense delete and undo restores linked receipt metadata', async () => {
  const { deleteRowWithUndo, restoreUndoItems } = await import('../src/crudLogic.mjs');
  const data = {
    expenseRows: [{ id: 'expense-1', receiptId: 'receipt-1', amount: 12.6 }],
    receipts: [{ id: 'receipt-1', expenseId: 'expense-1', vendor: 'Cafe' }],
    mileageRows: [],
    workLogs: [],
  };

  const result = deleteRowWithUndo(data, 'expenseRows', 'expense-1');
  assert.deepEqual(result.data.expenseRows, []);
  assert.deepEqual(result.data.receipts, []);
  assert.deepEqual(restoreUndoItems(result.data, result.undo).expenseRows, data.expenseRows);
  assert.deepEqual(restoreUndoItems(result.data, result.undo).receipts, data.receipts);
});

test('receipt-only delete clears and undo restores expense receipt link', async () => {
  const { deleteRowWithUndo, restoreUndoItems } = await import('../src/crudLogic.mjs');
  const data = {
    expenseRows: [{ id: 'expense-1', receiptId: 'receipt-1', amount: 12.6 }],
    receipts: [{ id: 'receipt-1', expenseId: 'expense-1', vendor: 'Cafe' }],
    mileageRows: [],
    workLogs: [],
  };

  const result = deleteRowWithUndo(data, 'receipts', 'receipt-1', { deleteLinkedExpense: false });
  assert.deepEqual(result.data.receipts, []);
  assert.equal(result.data.expenseRows[0].receiptId, '');
  const restored = restoreUndoItems(result.data, result.undo);
  assert.deepEqual(restored.receipts, data.receipts);
  assert.equal(restored.expenseRows[0].receiptId, 'receipt-1');
});

test('mileage delete and undo preserves route geometry', async () => {
  const { deleteRowWithUndo, restoreUndoItems } = await import('../src/crudLogic.mjs');
  const route = [{ lat: 34.1, lng: -117.2 }, { lat: 35.1, lng: -118.2 }];
  const data = {
    expenseRows: [],
    receipts: [],
    workLogs: [],
    mileageRows: [{ id: 'mile-1', calculationMode: 'address-route', routeGeometry: route, miles: 42 }],
  };

  const result = deleteRowWithUndo(data, 'mileageRows', 'mile-1');
  assert.deepEqual(result.data.mileageRows, []);
  assert.deepEqual(restoreUndoItems(result.data, result.undo).mileageRows[0].routeGeometry, route);
});

test('archive project filter hides soft-deleted projects except in trash', async () => {
  const { visibleProjectsForArchive } = await import('../src/crudLogic.mjs');
  const projects = [
    { id: 'active', status: 'active' },
    { id: 'archived', status: 'archived' },
    { id: 'deleted', status: 'deleted' },
  ];

  assert.deepEqual(visibleProjectsForArchive(projects, 'active').map((project) => project.id), ['active', 'archived']);
  assert.deepEqual(visibleProjectsForArchive(projects, 'trash').map((project) => project.id), ['deleted']);
});
