function blankProjectData() {
  return {
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

  return {
    report: { ...blank.report, ...report },
    expenseRows: Array.isArray(source.expenseRows) ? source.expenseRows : [],
    mileageRows: Array.isArray(source.mileageRows) ? source.mileageRows : [],
    workLogs: Array.isArray(source.workLogs) ? source.workLogs : [],
    receipts: Array.isArray(source.receipts) ? source.receipts : [],
  };
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
    title: deriveProjectTitle({ ...project, data }),
    status: project.status || 'active',
    reportNo: data.report.reportNo || '',
    employeeName: data.report.employeeName || '',
    periodFrom: data.report.periodFrom || '',
    periodTo: data.report.periodTo || '',
    updatedAt: project.updatedAt || project.createdAt || null,
    createdAt: project.createdAt || null,
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
  deriveProjectTitle,
  normalizeProjectData,
  projectPayload,
  projectSummary,
};
