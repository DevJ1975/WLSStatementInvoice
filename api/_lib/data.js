function blankProjectData() {
  return {
    meta: {
      clientName: '',
      jobNumber: '',
      siteName: '',
      siteAddress: '',
      poNumber: '',
      invoiceNumber: '',
      billingContact: '',
      billingEmail: '',
      notes: '',
    },
    report: {
      employeeName: '',
      address: '',
      employeeId: '',
      phone: '',
      email: '',
      reportNo: '',
      reportDate: '',
      periodFrom: '',
      periodTo: '',
      engagement: '',
      laborTitle: '',
      laborDescription: '',
      laborDays: 0,
      dailyRate: 0,
      onsiteFrom: '',
      onsiteTo: '',
      onsiteDescription: 'Onsite work',
      onsiteDays: 0,
      onsiteRate: 0,
      remoteFrom: '',
      remoteTo: '',
      remoteDescription: 'Remote work',
      remoteDays: 0,
      remoteRate: 0,
    },
    expenseRows: [],
    mileageRows: [],
    workLogs: [],
    receipts: [],
  };
}

function normalizeProjectData(data) {
  const blank = blankProjectData();
  const source = data && typeof data === 'object' ? data : {};
  const report = source.report && typeof source.report === 'object' ? source.report : {};
  const meta = source.meta && typeof source.meta === 'object' ? source.meta : {};

  return {
    meta: { ...blank.meta, ...meta },
    report: { ...blank.report, ...report },
    expenseRows: Array.isArray(source.expenseRows) ? source.expenseRows : [],
    mileageRows: Array.isArray(source.mileageRows) ? source.mileageRows : [],
    workLogs: Array.isArray(source.workLogs) ? source.workLogs : [],
    receipts: Array.isArray(source.receipts) ? source.receipts : [],
  };
}

function currentDateInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function isValidDateInput(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function weekdayCountInRange(from, to) {
  if (!isValidDateInput(from) || !isValidDateInput(to)) return 0;
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (start > end) return 0;
  let count = 0;
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const day = date.getDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

function dateInsidePeriod(date, periodFrom, periodTo) {
  if (!isValidDateInput(date)) return true;
  if (isValidDateInput(periodFrom) && date < periodFrom) return false;
  if (isValidDateInput(periodTo) && date > periodTo) return false;
  return true;
}

function suggestNextSequence(values) {
  const candidates = values
    .filter(Boolean)
    .map((value) => String(value).trim().match(/^(.*?)(\d+)(\D*)$/))
    .filter(Boolean)
    .map((match) => ({
      prefix: match[1],
      number: Number(match[2]),
      width: match[2].length,
      suffix: match[3],
    }))
    .filter((candidate) => Number.isFinite(candidate.number));

  if (!candidates.length) return '';
  candidates.sort((a, b) => b.number - a.number);
  const top = candidates[0];
  return `${top.prefix}${String(top.number + 1).padStart(top.width, '0')}${top.suffix}`;
}

function defaultEntryValues(projects = [], defaults = {}) {
  const normalized = projects.map((project) => normalizeProjectData(project.data || project));
  return {
    employeeName: defaults.employeeName || normalized.find((data) => data.report.employeeName)?.report.employeeName || '',
    address: defaults.address || normalized.find((data) => data.report.address)?.report.address || '',
    phone: defaults.phone || normalized.find((data) => data.report.phone)?.report.phone || '',
    email: defaults.email || normalized.find((data) => data.report.email)?.report.email || '',
    employeeId: defaults.employeeId || normalized.find((data) => data.report.employeeId)?.report.employeeId || '',
    mileageRate: defaults.mileageRate || '0.725',
    reportDate: currentDateInputValue(),
    reportNo: suggestNextSequence(normalized.map((data) => data.report.reportNo)),
    invoiceNumber: suggestNextSequence(normalized.map((data) => data.meta.invoiceNumber)),
    clientName: defaults.clientName || '',
    siteName: defaults.siteName || '',
    siteAddress: defaults.siteAddress || '',
  };
}

function inferReceiptCategory(vendor, fallbackCategory, defaults = {}) {
  const key = String(vendor || '').trim().toLowerCase();
  return (key && defaults.vendorCategories?.[key]) || fallbackCategory || 'Misc.';
}

function projectReviewChecklist(projectData) {
  const data = normalizeProjectData(projectData);
  const items = [];
  const required = [
    ['Client name', data.meta.clientName],
    ['Employee name', data.report.employeeName],
    ['Invoice/report number', data.meta.invoiceNumber || data.report.reportNo],
    ['Report date', data.report.reportDate],
    ['Period start', data.report.periodFrom],
    ['Period end', data.report.periodTo],
  ];

  required.forEach(([label, value]) => {
    if (!value) items.push({ type: 'missing', label: `${label} is missing` });
  });

  data.expenseRows.forEach((row) => {
    const hasReceipt = row.receiptId || data.receipts.some((receipt) => receipt.expenseId === row.id || receipt.id === row.receiptId);
    if (!hasReceipt) items.push({ type: 'warning', label: `Expense missing receipt: ${row.vendor || row.description || row.date || 'Untitled expense'}` });
  });

  data.workLogs.forEach((row) => {
    if (!dateInsidePeriod(row.date, data.report.periodFrom, data.report.periodTo)) {
      items.push({ type: 'warning', label: `Work log date outside period: ${row.date}` });
    }
    const hasMileage = data.mileageRows.some((mileage) => mileage.date === row.date);
    if (!hasMileage) items.push({ type: 'warning', label: `Work log has no mileage for ${row.date}` });
  });

  data.mileageRows.forEach((row) => {
    if (!dateInsidePeriod(row.date, data.report.periodFrom, data.report.periodTo)) {
      items.push({ type: 'warning', label: `Mileage date outside period: ${row.date}` });
    }
  });

  [
    ['Onsite', data.report.onsiteFrom, data.report.onsiteTo, data.report.onsiteDays],
    ['Remote', data.report.remoteFrom, data.report.remoteTo, data.report.remoteDays],
  ].forEach(([label, from, to, days]) => {
    const expected = weekdayCountInRange(from, to);
    if (expected && Number(days || 0) !== expected) {
      items.push({ type: 'warning', label: `${label} day count is ${days || 0}; weekday range is ${expected}` });
    }
  });

  return items;
}

function deriveProjectTitle(project) {
  const report = project.data?.report || {};
  const pieces = [
    report.reportNo ? `Report ${report.reportNo}` : '',
    report.employeeName || report.engagement || '',
    report.periodFrom && report.periodTo ? `${report.periodFrom} to ${report.periodTo}` : '',
  ].filter(Boolean);

  return project.title || pieces.join(' - ') || 'Untitled expense project';
}

function projectSummary(project) {
  const data = normalizeProjectData(project.data);

  return {
    id: String(project._id),
    siteId: project.siteId || 'default',
    memberId: project.memberId || '',
    createdBy: project.createdBy || '',
    updatedBy: project.updatedBy || '',
    title: deriveProjectTitle({ ...project, data }),
    status: project.status || 'active',
    reportNo: data.report.reportNo || '',
    employeeName: data.report.employeeName || '',
    periodFrom: data.report.periodFrom || '',
    periodTo: data.report.periodTo || '',
    updatedAt: project.updatedAt || project.createdAt || null,
    createdAt: project.createdAt || null,
    aiReviews: project.aiReviews || null,
  };
}

function projectPayload(project) {
  return {
    ...projectSummary(project),
    data: normalizeProjectData(project.data),
  };
}

module.exports = {
  blankProjectData,
  currentDateInputValue,
  dateInsidePeriod,
  defaultEntryValues,
  deriveProjectTitle,
  inferReceiptCategory,
  normalizeProjectData,
  projectPayload,
  projectReviewChecklist,
  projectSummary,
  suggestNextSequence,
  weekdayCountInRange,
};
