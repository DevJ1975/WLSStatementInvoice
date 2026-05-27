function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export function restoreUndoItems(projectData, undo) {
  const next = cloneValue(projectData);
  (undo?.removeOnUndo || []).forEach((item) => {
    if (!Array.isArray(next[item.collection])) return;
    next[item.collection] = next[item.collection].filter((row) => row.id !== item.id);
  });
  (undo?.updates || []).forEach((item) => {
    if (!Array.isArray(next[item.collection])) return;
    const index = next[item.collection].findIndex((row) => row.id === item.row?.id);
    if (index >= 0) next[item.collection][index] = cloneValue(item.row);
  });
  (undo?.items || []).forEach((item) => {
    if (!Array.isArray(next[item.collection])) next[item.collection] = [];
    const exists = next[item.collection].some((row) => row.id === item.row?.id);
    if (exists) return;
    const index = Math.max(0, Math.min(Number(item.index || 0), next[item.collection].length));
    next[item.collection].splice(index, 0, cloneValue(item.row));
  });
  return next;
}

export function deleteRowWithUndo(projectData, collection, id, options = {}) {
  const next = cloneValue(projectData);
  const source = Array.isArray(next[collection]) ? next[collection] : [];
  const index = source.findIndex((row) => row.id === id);
  if (index < 0) return { data: next, undo: null };

  const items = [{ collection, index, row: source[index] }];
  const updates = [];
  source.splice(index, 1);

  if (collection === 'expenseRows') {
    const linkedReceipts = next.receipts
      .map((receipt, receiptIndex) => ({ receipt, receiptIndex }))
      .filter(({ receipt }) => receipt.expenseId === id || receipt.id === items[0].row.receiptId);
    linkedReceipts.reverse().forEach(({ receipt, receiptIndex }) => {
      items.push({ collection: 'receipts', index: receiptIndex, row: receipt });
      next.receipts.splice(receiptIndex, 1);
    });
  }

  if (collection === 'receipts' && options.deleteLinkedExpense !== false) {
    const receipt = items[0].row;
    const expenseIndex = next.expenseRows.findIndex((row) => row.id === receipt.expenseId || row.receiptId === receipt.id);
    if (expenseIndex >= 0) {
      items.push({ collection: 'expenseRows', index: expenseIndex, row: next.expenseRows[expenseIndex] });
      next.expenseRows.splice(expenseIndex, 1);
    }
  } else if (collection === 'receipts') {
    const receipt = items[0].row;
    next.expenseRows = next.expenseRows.map((row) => {
      if (row.id !== receipt.expenseId && row.receiptId !== receipt.id) return row;
      updates.push({ collection: 'expenseRows', row });
      return { ...row, receiptId: '' };
    });
  }

  return {
    data: next,
    undo: {
      label: options.label || `${collection} row deleted.`,
      items,
      updates,
      selectedMileageId: options.selectedMileageId || '',
    },
  };
}

export function replaceRowsWithUndo(projectData, collection, predicate, replacementRows, label) {
  const next = cloneValue(projectData);
  const source = Array.isArray(next[collection]) ? next[collection] : [];
  const removed = [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (predicate(source[index])) {
      removed.push({ collection, index, row: source[index] });
      source.splice(index, 1);
    }
  }
  const insertIndex = removed.length ? Math.min(...removed.map((item) => item.index)) : source.length;
  source.splice(insertIndex, 0, ...cloneValue(replacementRows));
  return {
    data: next,
    undo: removed.length
      ? {
          label,
          items: removed.reverse(),
          removeOnUndo: cloneValue(replacementRows).map((row) => ({ collection, id: row.id })),
        }
      : null,
  };
}

export function visibleProjectsForArchive(projects, filter = 'active') {
  const normalizedFilter = filter === 'trash' ? 'trash' : 'active';
  return (Array.isArray(projects) ? projects : []).filter((project) =>
    normalizedFilter === 'trash' ? project.status === 'deleted' : project.status !== 'deleted'
  );
}
