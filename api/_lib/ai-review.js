const { normalizeProjectData, projectReviewChecklist, weekdayCountInRange } = require('./data');

const defaultAnthropicModel = 'claude-sonnet-4-20250514';
const maxOcrChars = 700;
const maxChatMessages = 8;
const maxChatChars = 1200;

function moneyNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function dateValid(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function insidePeriod(date, from, to) {
  if (!dateValid(date)) return true;
  if (dateValid(from) && date < from) return false;
  if (dateValid(to) && date > to) return false;
  return true;
}

function statementRows(data) {
  const report = data.report;
  const rows = [
    {
      label: 'Onsite Work',
      days: Number(report.onsiteDays || 0),
      rate: Number(report.onsiteRate || 0),
      description: report.onsiteDescription || 'Onsite work',
    },
    {
      label: 'Remote Work',
      days: Number(report.remoteDays || 0),
      rate: Number(report.remoteRate || 0),
      description: report.remoteDescription || 'Remote work',
    },
  ];
  const hasModernLabor = rows.some((row) => row.days || row.rate || (row.description && !['Onsite work', 'Remote work'].includes(row.description)));
  const hasLegacyLabor = Boolean(report.laborDescription || Number(report.laborDays || 0) || Number(report.dailyRate || 0));
  if (!hasModernLabor && hasLegacyLabor) {
    return [
      {
        label: report.laborTitle || 'Labor',
        days: Number(report.laborDays || 0),
        rate: Number(report.dailyRate || 0),
        description: report.laborDescription || 'Labor',
      },
    ];
  }
  return rows;
}

function calculateProjectTotals(projectData) {
  const data = normalizeProjectData(projectData);
  const laborTotal = statementRows(data).reduce((sum, row) => sum + Number(row.days || 0) * Number(row.rate || 0), 0);
  const expenseTotal = data.expenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const mileageTotal = data.mileageRows.reduce((sum, row) => sum + Number(row.miles || 0) * Number(row.rate || 0), 0);
  const totalMiles = data.mileageRows.reduce((sum, row) => sum + Number(row.miles || 0), 0);
  return {
    laborTotal: moneyNumber(laborTotal),
    expenseTotal: moneyNumber(expenseTotal),
    mileageTotal: moneyNumber(mileageTotal),
    totalDue: moneyNumber(laborTotal + expenseTotal + mileageTotal),
    totalMiles: Math.round(totalMiles * 10) / 10,
  };
}

function issue(severity, label, field = '', detail = '') {
  return { severity, label, field, detail };
}

function receiptForExpense(data, row) {
  return data.receipts.find((receipt) => receipt.expenseId === row.id || receipt.id === row.receiptId);
}

function duplicateKey(parts) {
  return parts.map((part) => String(part || '').trim().toLowerCase()).join('|');
}

function deterministicPreflight(project, options = {}) {
  const data = normalizeProjectData(project?.data || project);
  const critical = [];
  const warnings = [];
  const suggestions = [];
  const report = data.report;
  const meta = data.meta;
  const exportType = options.exportType || 'review';

  [
    ['Client name', meta.clientName, 'meta.clientName'],
    ['Employee name', report.employeeName, 'report.employeeName'],
    ['Account #', report.employeeId, 'report.employeeId'],
    ['Invoice/report number', meta.invoiceNumber || report.reportNo, 'meta.invoiceNumber'],
    ['Report date', report.reportDate, 'report.reportDate'],
    ['Period start', report.periodFrom, 'report.periodFrom'],
    ['Period end', report.periodTo, 'report.periodTo'],
  ].forEach(([label, value, field]) => {
    if (!value) critical.push(issue('critical', `${label} is required before preparing the accounting package.`, field));
  });

  if (report.periodFrom && !dateValid(report.periodFrom)) critical.push(issue('critical', 'Period start must be a valid date.', 'report.periodFrom'));
  if (report.periodTo && !dateValid(report.periodTo)) critical.push(issue('critical', 'Period end must be a valid date.', 'report.periodTo'));
  if (dateValid(report.periodFrom) && dateValid(report.periodTo) && report.periodFrom > report.periodTo) {
    critical.push(issue('critical', 'Period start cannot be after period end.', 'report.periodFrom'));
  }

  projectReviewChecklist(data).forEach((item) => {
    if (/missing receipt/i.test(item.label)) critical.push(issue('critical', item.label, 'expenseRows'));
    else if (/ is missing$/i.test(item.label)) critical.push(issue('critical', item.label, 'report'));
    else warnings.push(issue('warning', item.label));
  });

  const expenseKeys = new Set();
  data.expenseRows.forEach((row, index) => {
    const rowLabel = `Expense row ${index + 1}`;
    const amount = Number(row.amount || 0);
    const rowReceipt = receiptForExpense(data, row);
    const key = duplicateKey([row.date, row.vendor, row.amount, row.description]);

    if (!row.date || !dateValid(row.date)) warnings.push(issue('warning', `${rowLabel} should have a valid date.`, `expenseRows.${index}.date`));
    if (!row.vendor) warnings.push(issue('warning', `${rowLabel} is missing a vendor.`, `expenseRows.${index}.vendor`));
    if (!row.category) warnings.push(issue('warning', `${rowLabel} is missing a category.`, `expenseRows.${index}.category`));
    if (!Number.isFinite(amount) || amount <= 0) critical.push(issue('critical', `${rowLabel} must have an amount greater than $0.`, `expenseRows.${index}.amount`));
    if (!rowReceipt) critical.push(issue('critical', `${rowLabel} is missing accountant receipt evidence.`, `expenseRows.${index}.receiptId`));
    if (expenseKeys.has(key)) warnings.push(issue('warning', `${rowLabel} looks like a duplicate expense.`, `expenseRows.${index}`));
    expenseKeys.add(key);

    if (rowReceipt) {
      const receiptAmount = Number(rowReceipt.amount || 0);
      if (receiptAmount && amount && Math.abs(receiptAmount - amount) > 0.02) {
        warnings.push(issue('warning', `${rowLabel} amount does not match its receipt metadata.`, `expenseRows.${index}.amount`));
      }
      if (!rowReceipt.imageFileId && !rowReceipt.imageUrl && !rowReceipt.previewUrl) {
        warnings.push(issue('warning', `${rowLabel} receipt metadata exists but the receipt image may be unavailable.`, `receipts.${rowReceipt.id}`));
      }
    }
  });

  const mileageKeys = new Set();
  data.mileageRows.forEach((row, index) => {
    const rowLabel = `Mileage row ${index + 1}`;
    const miles = Number(row.miles || 0);
    const rate = Number(row.rate || 0);
    const key = duplicateKey([row.date, row.from, row.to, row.purpose, row.miles]);
    if (!row.date || !dateValid(row.date)) warnings.push(issue('warning', `${rowLabel} should have a valid date.`, `mileageRows.${index}.date`));
    if (!insidePeriod(row.date, report.periodFrom, report.periodTo)) warnings.push(issue('warning', `${rowLabel} date is outside the report period.`, `mileageRows.${index}.date`));
    if (!Number.isFinite(miles) || miles <= 0) critical.push(issue('critical', `${rowLabel} must have miles greater than 0.`, `mileageRows.${index}.miles`));
    if (!Number.isFinite(rate) || rate < 0) critical.push(issue('critical', `${rowLabel} must have a valid reimbursement rate.`, `mileageRows.${index}.rate`));
    if (!row.from || !row.to) warnings.push(issue('warning', `${rowLabel} should include both From and To locations.`, `mileageRows.${index}`));
    if (['address-route', 'gps'].includes(row.calculationMode || row.trackingMode) && !(row.routeGeometry?.length || row.routePoints?.length)) {
      warnings.push(issue('warning', `${rowLabel} says it was route-calculated but has no saved route geometry.`, `mileageRows.${index}.routeGeometry`));
    }
    if (mileageKeys.has(key)) warnings.push(issue('warning', `${rowLabel} looks like duplicate mileage.`, `mileageRows.${index}`));
    mileageKeys.add(key);
  });

  data.workLogs.forEach((row, index) => {
    const rowLabel = `Work log row ${index + 1}`;
    if (!row.date || !dateValid(row.date)) warnings.push(issue('warning', `${rowLabel} should have a valid date.`, `workLogs.${index}.date`));
    if (!insidePeriod(row.date, report.periodFrom, report.periodTo)) warnings.push(issue('warning', `${rowLabel} date is outside the report period.`, `workLogs.${index}.date`));
    if (String(row.status || '').toLowerCase() === 'draft') warnings.push(issue('warning', `${rowLabel} is still marked Draft.`, `workLogs.${index}.status`));
    if (!Number(row.hours || 0)) warnings.push(issue('warning', `${rowLabel} is missing hours.`, `workLogs.${index}.hours`));
    if (!row.summary && !row.actions) suggestions.push(issue('suggestion', `${rowLabel} could use a short generated summary.`, `workLogs.${index}.summary`));
  });

  [
    ['Onsite', report.onsiteFrom, report.onsiteTo, report.onsiteDays, 'onsiteDays'],
    ['Remote', report.remoteFrom, report.remoteTo, report.remoteDays, 'remoteDays'],
  ].forEach(([label, from, to, days, field]) => {
    const expected = weekdayCountInRange(from, to);
    if (expected && Number(days || 0) !== expected) {
      warnings.push(issue('warning', `${label} day count is ${days || 0}; weekday range is ${expected}.`, `report.${field}`));
    }
  });

  if (exportType !== 'review' && project?.updatedAt && project?.aiReviews?.checkedAt && new Date(project.updatedAt) > new Date(project.aiReviews.checkedAt)) {
    suggestions.push(issue('suggestion', 'The project changed after the last AI review; run a fresh review before final emailing.', 'aiReviews.checkedAt'));
  }

  const totalsReview = {
    ...calculateProjectTotals(data),
    status: critical.length ? 'blocked' : 'calculated',
  };

  return {
    status: critical.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    critical,
    warnings,
    suggestions,
    totalsReview,
    deterministicChecklist: projectReviewChecklist(data),
  };
}

function compactProjectForAi(project, options = {}) {
  const data = normalizeProjectData(project?.data || project);
  const totals = calculateProjectTotals(data);
  return {
    exportType: options.exportType || 'review',
    project: {
      id: String(project?._id || project?.id || ''),
      title: project?.title || '',
      status: project?.status || 'active',
      updatedAt: project?.updatedAt || null,
    },
    meta: data.meta,
    report: data.report,
    totals,
    expenses: data.expenseRows.map((row, index) => ({
      row: index + 1,
      id: row.id || '',
      date: row.date || '',
      vendor: row.vendor || '',
      description: row.description || '',
      category: row.category || '',
      amount: moneyNumber(row.amount),
      receiptId: row.receiptId || '',
    })),
    mileage: data.mileageRows.map((row, index) => ({
      row: index + 1,
      id: row.id || '',
      date: row.date || '',
      from: row.from || '',
      to: row.to || '',
      purpose: row.purpose || '',
      miles: Number(row.miles || 0),
      rate: Number(row.rate || 0),
      amount: moneyNumber(Number(row.miles || 0) * Number(row.rate || 0)),
      mode: row.trackingMode || row.calculationMode || 'manual',
      hasRoute: Boolean(row.routeGeometry?.length || row.routePoints?.length),
    })),
    workLogs: data.workLogs.map((row, index) => ({
      row: index + 1,
      id: row.id || '',
      date: row.date || '',
      taskCategory: row.taskCategory || '',
      hours: Number(row.hours || 0),
      status: row.status || '',
      summary: row.summary || '',
      actions: row.actions || '',
    })),
    receipts: data.receipts.map((receipt, index) => ({
      row: index + 1,
      id: receipt.id || '',
      expenseId: receipt.expenseId || '',
      vendor: receipt.vendor || '',
      date: receipt.date || '',
      amount: moneyNumber(receipt.amount),
      category: receipt.category || '',
      hasImage: Boolean(receipt.imageFileId || receipt.imageUrl || receipt.previewUrl),
      ocrText: String(receipt.ocrText || '').slice(0, maxOcrChars),
    })),
  };
}

function aiSystemPrompt() {
  return [
    'You are Julie, the WLS Expense Invoicer report assistant.',
    'Your job is to review the current expense report project: statement, expenses, mileage, work logs, receipts, totals, PDF readiness, and Excel readiness.',
    'You are not a general coding assistant inside this app.',
    'Do not provide code snippets, implementation advice, file paths, API route names, database schema advice, or developer instructions unless the user explicitly asks for software development help.',
    'If the user asks to check for errors, review this report, find issues, or decide whether it is ready to send, focus only on the current report data and deterministic review results.',
    'When reviewing a report, reference exact row numbers when possible, such as Expense row 1, Mileage row 2, Work log row 3, or receipt references.',
    'Never claim the report is perfect. Say whether it appears ready based on the provided data.',
    'Do not invent records, do not request secrets, and do not suggest automatic edits.',
    'Prioritize: required statement fields, receipt evidence, date consistency, totals, duplicate-looking entries, work-log/mileage alignment, and package readiness.',
    'Return only JSON when asked for a preflight review.',
  ].join(' ');
}

function preflightUserPrompt(compactProject, deterministicReview) {
  return JSON.stringify({
    task: 'Review this WLS accounting package for errors before download/email. Return JSON only with keys critical, warnings, suggestions, summary.',
    expectedShape: {
      critical: ['Only issues that should block export/email.'],
      warnings: ['Issues user can acknowledge if intentional.'],
      suggestions: ['Helpful cleanup ideas.'],
      summary: 'One short plain-English review summary.',
    },
    deterministicReview,
    compactProject,
  });
}

function normalizeIssueList(list, severity) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (typeof item === 'string') return issue(severity, item);
      return issue(severity, item?.label || item?.message || item?.title || '', item?.field || '', item?.detail || item?.reason || '');
    })
    .filter((item) => item.label);
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude did not return JSON.');
    return JSON.parse(match[0]);
  }
}

async function callClaude(messages, system, options = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const error = new Error('Missing ANTHROPIC_API_KEY environment variable.');
    error.code = 'AI_SETUP_REQUIRED';
    throw error;
  }

  const model = process.env.ANTHROPIC_MODEL || defaultAnthropicModel;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens || 1400,
      temperature: options.temperature ?? 0.2,
      system,
      messages,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || 'Claude review failed.');
  }

  const text = (payload.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
  return { text, model, usage: payload.usage || null };
}

function mergeReviews(deterministic, claudeJson = {}) {
  const critical = [...deterministic.critical, ...normalizeIssueList(claudeJson.critical, 'critical')];
  const warnings = [...deterministic.warnings, ...normalizeIssueList(claudeJson.warnings, 'warning')];
  const suggestions = [...deterministic.suggestions, ...normalizeIssueList(claudeJson.suggestions, 'suggestion')];
  return {
    status: critical.length ? 'fail' : warnings.length ? 'warning' : 'pass',
    critical,
    warnings,
    suggestions,
    totalsReview: deterministic.totalsReview,
    summary:
      typeof claudeJson.summary === 'string' && claudeJson.summary.trim()
        ? claudeJson.summary.trim().slice(0, 500)
        : critical.length
          ? 'Critical issues must be fixed before this package is ready.'
          : warnings.length
            ? 'The package has warnings to review before final emailing.'
            : 'The package appears ready based on the current business rules.',
  };
}

async function runClaudePreflight(project, options = {}) {
  const deterministic = deterministicPreflight(project, options);
  const compactProject = compactProjectForAi(project, options);
  const { text, model, usage } = await callClaude(
    [{ role: 'user', content: preflightUserPrompt(compactProject, deterministic) }],
    aiSystemPrompt(),
    { maxTokens: 1800, temperature: 0.1 }
  );
  const claudeJson = parseJsonObject(text);
  return {
    ...mergeReviews(deterministic, claudeJson),
    checkedAt: new Date().toISOString(),
    model,
    usage,
  };
}

function sanitizeChatMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .slice(-maxChatMessages)
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content || '').slice(0, maxChatChars),
    }))
    .filter((message) => message.content);
}

function latestUserMessage(messages) {
  return [...messages].reverse().find((message) => message.role === 'user')?.content || '';
}

function isReportReviewIntent(text) {
  const value = String(text || '').toLowerCase();
  return (
    /\b(check|find|scan|look|review|audit|inspect)\b.{0,60}\b(error|errors|issue|issues|mistake|mistakes|problem|problems|missing|ready|report|package)\b/.test(value) ||
    /\b(review|audit|inspect)\b.{0,40}\b(report|expense report|package|statement)\b/.test(value) ||
    /\b(is|does|can)\b.{0,25}\b(this|it|report|package)\b.{0,40}\b(ready|ok|okay|complete)\b/.test(value) ||
    /\bready\b.{0,40}\b(send|email|export|download|submit)\b/.test(value) ||
    /\b(wrong|missing|problem|issue|errors?)\b.{0,40}\b(expense|expenses|receipt|receipts|mileage|work log|statement|total|totals|report)\b/.test(value)
  );
}

function buildChatTask(reportReviewIntent) {
  const baseRules = [
    'Use only the current compactProject data and deterministicReview results.',
    'Do not edit records or claim changes were made.',
    'Do not provide code, implementation steps, file names, API routes, or developer instructions unless the user explicitly asks for software development help.',
    'If information is missing from the current report payload, say what is missing instead of guessing.',
  ];

  if (!reportReviewIntent) {
    return {
      mode: 'report-question',
      task: 'Answer questions about this WLS report using the business rules and current project data.',
      responseRules: [
        ...baseRules,
        'Be concise and point to exact rows when possible.',
        'For totals questions, explain how labor, expenses, and mileage roll into total due.',
      ],
    };
  }

  return {
    mode: 'report-review',
    task: 'Review the current WLS expense report for errors, omissions, and export/email readiness.',
    responseFormat: ['Critical', 'Warnings', 'Suggestions', 'Ready status'],
    responseRules: [
      ...baseRules,
      'Answer as a short checklist using the headings Critical, Warnings, Suggestions, and Ready status.',
      'Focus on required statement fields, expense receipts, mileage math/routes, work-log dates/status, duplicate-looking rows, totals, and package readiness.',
      'Reference exact row numbers from compactProject when possible, using labels like Expense row 1, Mileage row 2, Work log row 3, and Receipt row 4.',
      'If there are no critical issues, say that clearly, then list warnings or suggestions.',
    ],
  };
}

function buildChatPrompt(project, messages = []) {
  const compactProject = compactProjectForAi(project, { exportType: 'chat' });
  const deterministic = deterministicPreflight(project, { exportType: 'chat' });
  const chatMessages = sanitizeChatMessages(messages);
  const reportReviewIntent = isReportReviewIntent(latestUserMessage(chatMessages));
  return {
    reportReviewIntent,
    chatMessages,
    prompt: {
      ...buildChatTask(reportReviewIntent),
      deterministicReview: deterministic,
      compactProject,
    },
  };
}

async function runClaudeChat(project, messages = []) {
  const { chatMessages, prompt, reportReviewIntent } = buildChatPrompt(project, messages);
  const { text, model, usage } = await callClaude(
    [
      {
        role: 'user',
        content: JSON.stringify(prompt),
      },
      ...chatMessages,
    ],
    aiSystemPrompt(),
    { maxTokens: reportReviewIntent ? 1200 : 1000, temperature: reportReviewIntent ? 0.2 : 0.3 }
  );
  return { message: text, model, usage, checkedAt: new Date().toISOString() };
}

module.exports = {
  buildChatPrompt,
  calculateProjectTotals,
  compactProjectForAi,
  deterministicPreflight,
  isReportReviewIntent,
  runClaudeChat,
  runClaudePreflight,
};
