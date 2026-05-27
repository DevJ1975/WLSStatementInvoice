<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { deleteRowWithUndo, replaceRowsWithUndo, restoreUndoItems, visibleProjectsForArchive } from './crudLogic.mjs';
import { createRoundTripRows, reverseRouteGeometry, routeThumbnailPolyline, workLogDatesMissingMileage } from './mileageLogic.mjs';
import {
  autoWorkLogSummary,
  datesForWeekdayRange,
  inferWorkTypeForDate,
  nextWeekdayInPeriod as nextAvailableWorkLogDate,
  workLogHourOptions,
  workLogLocationForType,
  workLogStatuses,
  workLogTypes,
} from './workLogLogic.mjs';

const archiveStorageKey = 'wls-project-archive-fallback-v1';
const archiveBackupStorageKey = 'wls-project-archive-backups-v1';
const entryDefaultsStorageKey = 'wls-entry-defaults-v1';
const deviceDraftPrefix = 'device-draft-';
const categories = ['Hotel', 'Transport', 'Fuel', 'Meals', 'Phone', 'Entertain.', 'Misc.'];
const mileageLocationTypes = ['home', 'office', 'site', 'hotel', 'airport', 'custom'];
const tabs = [
  ['dashboard', 'Dashboard'],
  ['archive', 'Archive'],
  ['statement', 'Statement'],
  ['expenses', 'Expense Report'],
  ['mileage', 'Mileage'],
  ['worklog', 'Work Log'],
  ['print', 'Print View'],
  ['quickbooks', 'QuickBooks'],
  ['admin', 'Admin'],
];
const logoUrl = '/wls-logo.jpg';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const mileageRate = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const headerDateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const headerTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});
const usStateAbbreviations = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
};
const gpsAccuracyLimit = 250;
const metersPerMile = 1609.344;
const receiptImageTargetBytes = 900 * 1024;
const receiptImageMaxBytes = 3 * 1024 * 1024;
const receiptImageMaxDimension = 1600;
const receiptImageMinDimension = 900;
const pdfMargin = 42;
const pdfHeaderTop = 26;
const pdfLogoWidth = 132;
const pdfLogoHeight = 56;
const pdfHeaderLineY = 94;
const pdfTableStartY = 114;
const autosaveDelayMs = 900;
const localArchiveDelayMs = 500;
const weatherRefreshMs = 15 * 60 * 1000;
const appVersionText = [`v${__APP_VERSION__}`, __APP_COMMIT__ ? `build ${__APP_COMMIT__}` : '', formatBuildDate(__APP_BUILD_DATE__)].filter(Boolean).join(' | ');
const footerBrandText = `Powered by Trainovate Technologies LLC Copyright 2026 | ${appVersionText}`;

const state = reactive({
  loading: true,
  saving: false,
  storage: 'loading',
  error: '',
  tab: 'dashboard',
  projects: [],
  currentProject: null,
  syncingLocal: false,
  recoveryStatus: '',
  lastSavedAt: '',
  lastSaveStatus: 'Not saved yet',
  saveNotice: '',
  duplicateWarning: '',
  undo: null,
  archiveFilter: 'active',
  editing: {
    expenseId: '',
    mileageId: '',
    workLogId: '',
  },
  receiptQueue: [],
  receiptOcrRunning: false,
  receiptUploading: false,
  receiptDraft: emptyReceiptDraft(),
  entryDefaults: blankEntryDefaults(),
  auth: {
    checked: false,
    authenticated: false,
    member: null,
    setupRequired: false,
    accountNumber: '',
    pinInput: '',
    loginError: '',
    loginLoading: false,
    setup: {
      name: '',
      email: '',
      phone: '',
      accountNumber: '',
      pin: '',
    },
  },
  admin: {
    loading: false,
    members: [],
    status: '',
    error: '',
    form: {
      name: '',
      email: '',
      phone: '',
      role: 'member',
      pin: '',
    },
  },
  preferences: {
    loading: false,
    saving: false,
    status: '',
    error: '',
    mileageLocations: [],
    draftLocation: blankSavedLocationDraft(),
  },
  mileageDrafts: [],
  gps: {
    active: false,
    watchId: null,
    startedAt: null,
    elapsedSeconds: 0,
    paused: false,
    pausedAt: null,
    pausedSeconds: 0,
    pauseSegments: [],
    routePoints: [],
    lastAccuracy: null,
    error: '',
    selectedMileageId: '',
  },
  places: {
    fromSuggestions: [],
    toSuggestions: [],
    loadingField: '',
    routeLoading: false,
    error: '',
  },
  calculator: {
    open: false,
    display: '0',
    storedValue: null,
    operator: '',
    waitingForOperand: false,
    history: '',
  },
  header: {
    now: new Date(),
    weatherLoading: false,
    weatherError: '',
    weather: {
      temperature: null,
      condition: '',
      code: null,
      isDay: true,
      windMph: null,
      locationLabel: 'Current location',
      updatedAt: '',
    },
  },
});

const routeMapEl = ref(null);
const backupFileInput = ref(null);
const receiptFileInput = ref(null);
const expenseForm = reactive({ date: '', vendor: '', description: '', category: 'Hotel', amount: '' });
const mileageForm = reactive({
  date: '',
  from: '',
  to: '',
  purpose: '',
  miles: '',
  rate: '0.725',
  fromSavedLocationId: '',
  toSavedLocationId: '',
  fromPlace: null,
  toPlace: null,
  routeGeometry: [],
  routeDistanceMiles: 0,
  routeDurationSeconds: 0,
  calculationMode: 'manual',
});
const workLogForm = reactive({
  date: '',
  clientSite: '',
  location: '',
  taskCategory: '',
  hours: '',
  hourPreset: '8',
  summary: '',
  actions: '',
  status: '',
  showDetails: false,
});
let gpsTimer = null;
let autosaveTimer = null;
let localArchiveTimer = null;
const addressTimers = {};
let routeMap = null;
let routeLayer = null;
let leafletApi = null;
let leafletLoader = null;
let clockTimer = null;
let weatherTimer = null;

const data = computed(() => state.currentProject?.data || blankProjectData());
const meta = computed(() => data.value.meta);
const report = computed(() => data.value.report);
const statementLaborRows = computed(() => {
  const rows = [
    {
      label: 'Onsite Work',
      date: formatDateRange(report.value.onsiteFrom, report.value.onsiteTo),
      description: report.value.onsiteDescription || 'Onsite work',
      days: Number(report.value.onsiteDays || 0),
      rate: Number(report.value.onsiteRate || 0),
    },
    {
      label: 'Remote Work',
      date: formatDateRange(report.value.remoteFrom, report.value.remoteTo),
      description: report.value.remoteDescription || 'Remote work',
      days: Number(report.value.remoteDays || 0),
      rate: Number(report.value.remoteRate || 0),
    },
  ];
  const hasNewRows = rows.some((row) => row.date || row.days || row.rate || (row.description && !['Onsite work', 'Remote work'].includes(row.description)));
  const hasLegacyLabor = Boolean(report.value.laborDescription || Number(report.value.laborDays || 0) || Number(report.value.dailyRate || 0));
  if (!hasNewRows && hasLegacyLabor) {
    return [
      {
        label: report.value.laborTitle || 'Labor',
        date: formatPeriod(),
        description: report.value.laborDescription,
        days: Number(report.value.laborDays || 0),
        rate: Number(report.value.dailyRate || 0),
      },
    ];
  }
  return rows;
});
const laborTotal = computed(() => statementLaborRows.value.reduce((sum, row) => sum + Number(row.days || 0) * Number(row.rate || 0), 0));
const expenseTotal = computed(() => data.value.expenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
const mileageTotal = computed(() => data.value.mileageRows.reduce((sum, row) => sum + Number(row.miles || 0) * Number(row.rate || 0), 0));
const totalMiles = computed(() => data.value.mileageRows.reduce((sum, row) => sum + Number(row.miles || 0), 0));
const totalDue = computed(() => laborTotal.value + expenseTotal.value + mileageTotal.value);
const totalHours = computed(() => data.value.workLogs.reduce((sum, row) => sum + Number(row.hours || 0), 0));
const avgHours = computed(() => (data.value.workLogs.length ? totalHours.value / data.value.workLogs.length : 0));
const expenseCategoryTotals = computed(() => categoryTotals(data.value.expenseRows));
const routeMileageRows = computed(() => data.value.mileageRows.filter((row) => rowRoutePoints(row).length));
const localProjectCount = computed(() => uniqueDeviceDrafts(deviceDraftProjects()).length);
const dashboardStats = computed(() => {
  const projects = state.projects || [];
  const billableProjects = projects.filter((project) => project.status !== 'deleted');
  return {
    active: billableProjects.filter((project) => project.status !== 'archived').length,
    archived: billableProjects.filter((project) => project.status === 'archived').length,
    expenses: billableProjects.reduce((sum, project) => sum + normalizeProject(project).data.expenseRows.reduce((rowSum, row) => rowSum + Number(row.amount || 0), 0), 0),
    miles: billableProjects.reduce((sum, project) => sum + normalizeProject(project).data.mileageRows.reduce((rowSum, row) => rowSum + Number(row.miles || 0), 0), 0),
    mileage: billableProjects.reduce((sum, project) => sum + normalizeProject(project).data.mileageRows.reduce((rowSum, row) => rowSum + Number(row.miles || 0) * Number(row.rate || 0), 0), 0),
    hours: billableProjects.reduce((sum, project) => sum + normalizeProject(project).data.workLogs.reduce((rowSum, row) => rowSum + Number(row.hours || 0), 0), 0),
  };
});
const syncStatusText = computed(() => {
  if (state.saving) return 'Saving...';
  if (state.storage === 'mongodb') return state.lastSavedAt ? `Cloud saved ${formatDateTime(state.lastSavedAt)}` : 'Cloud sync active';
  return state.lastSavedAt ? `Saved on this device ${formatDateTime(state.lastSavedAt)}` : 'Local fallback';
});
const selectedMileageDraft = computed(() => state.mileageDrafts.find((draft) => draft.id === state.gps.selectedMileageId) || null);
const selectedMileageRoute = computed(() => {
  if (state.gps.selectedMileageId === 'draft-route') return null;
  if (selectedMileageDraft.value) return selectedMileageDraft.value;
  return routeMileageRows.value.find((row) => row.id === state.gps.selectedMileageId) || routeMileageRows.value[0] || null;
});
const displayedRoutePoints = computed(() => {
  if (state.gps.active) return state.gps.routePoints;
  if (state.gps.selectedMileageId === 'draft-route') return mileageForm.routeGeometry;
  if (selectedMileageDraft.value) return rowRoutePoints(selectedMileageDraft.value);
  return rowRoutePoints(selectedMileageRoute.value);
});
const liveGpsMiles = computed(() => metersToMiles(totalRouteMeters(state.gps.routePoints)));
const liveGpsDuration = computed(() => state.gps.elapsedSeconds);
const workLogCategoryTotals = computed(() =>
  data.value.workLogs.reduce((totals, row) => {
    const key = row.taskCategory || 'Uncategorized';
    totals[key] = (totals[key] || 0) + Number(row.hours || 0);
    return totals;
  }, {})
);
const projectReviewItems = computed(() => buildProjectReviewItems(data.value));
const receiptDraftMissingFields = computed(() => missingReceiptDraftFields());
const headerDateText = computed(() => headerDateFormatter.format(state.header.now));
const headerTimeText = computed(() => headerTimeFormatter.format(state.header.now));
const weatherVisualClass = computed(() => weatherIconClass(state.header.weather.code, state.header.weather.isDay));
const weatherText = computed(() => {
  if (state.header.weatherLoading) return 'Updating weather';
  if (state.header.weatherError) return state.header.weatherError;
  if (state.header.weather.temperature === null) return 'Weather pending';
  return `${Math.round(state.header.weather.temperature)}°F ${state.header.weather.condition}`;
});
const reportAddressLines = computed(() => formatPostalAddressLines(report.value.address));
const isAdmin = computed(() => state.auth.member?.role === 'admin');
const visibleTabs = computed(() => tabs.filter(([key]) => key !== 'admin' || isAdmin.value));
const membersById = computed(() => new Map(state.admin.members.map((member) => [member.id, member])));
const currentProjectMember = computed(() => membersById.value.get(state.currentProject?.memberId) || null);
const accountFieldReadonly = computed(() => state.auth.member?.role === 'member' || Boolean(currentProjectMember.value));
const printReceiptPages = computed(() => chunkList(data.value.receipts, 4));
const compactExpenseRows = computed(() =>
  data.value.expenseRows.map((row, index) => ({
    ...row,
    rowNumber: index + 1,
    receiptReference: receiptReferenceForExpenseRow(row, index),
  }))
);
const compactMileageRows = computed(() =>
  data.value.mileageRows.map((row, index) => ({
    ...row,
    rowNumber: index + 1,
    amount: Number(row.miles || 0) * Number(row.rate || 0),
    source:
      row.trackingMode === 'gps'
        ? 'GPS'
        : row.calculationMode === 'address-route'
          ? 'Auto route'
          : 'Manual',
  }))
);
const workLogSummaryRows = computed(() => summarizeWorkLogs(data.value.workLogs));
const workLogDateHasExisting = computed(() => data.value.workLogs.some((row) => row.date === workLogForm.date && row.id !== state.editing.workLogId));
const workLogDateOutsideLaborRanges = computed(() => {
  if (!workLogForm.date) return false;
  const hasLaborRanges = (report.value.onsiteFrom && report.value.onsiteTo) || (report.value.remoteFrom && report.value.remoteTo);
  if (!hasLaborRanges) return false;
  return !(
    (report.value.onsiteFrom && report.value.onsiteTo && dateInsideRange(workLogForm.date, report.value.onsiteFrom, report.value.onsiteTo)) ||
    (report.value.remoteFrom && report.value.remoteTo && dateInsideRange(workLogForm.date, report.value.remoteFrom, report.value.remoteTo))
  );
});
const workLogTypeOptions = computed(() => [...new Set([...workLogTypes, ...state.entryDefaults.workCategories].filter(Boolean))]);
const archiveProjects = computed(() => visibleProjectsForArchive(state.projects, state.archiveFilter));
const generatedWorkLogSummary = computed(() =>
  autoWorkLogSummary({
    workType: workLogForm.taskCategory,
    clientSite: workLogForm.clientSite,
    location: workLogForm.location,
    notes: workLogForm.actions,
  })
);
const savedMileageLocations = computed(() => state.preferences.mileageLocations);
const selectedMileageDrafts = computed(() => state.mileageDrafts.filter((draft) => draft.selected));

function newId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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

function blankProject(title = 'Untitled expense project') {
  const now = new Date().toISOString();
  return {
    id: `local-${newId()}`,
    title,
    status: 'active',
    data: blankProjectData(),
    createdAt: now,
    updatedAt: now,
  };
}

function emptyReceiptDraft() {
  return {
    date: '',
    vendor: '',
    category: 'Misc.',
    amount: '',
    paymentMethod: '',
    notes: '',
    ocrText: '',
    fileName: '',
    imageBlob: null,
    previewUrl: '',
    originalSize: 0,
    compressedSize: 0,
  };
}

function blankSavedLocationDraft() {
  return {
    label: '',
    type: 'home',
    address: '',
  };
}

function blankEntryDefaults() {
  return {
    employeeName: '',
    address: '',
    employeeId: '',
    phone: '',
    email: '',
    mileageRate: '0.725',
    startAddress: '',
    clientName: '',
    siteName: '',
    siteAddress: '',
    billingContact: '',
    billingEmail: '',
    recentVendors: [],
    vendorCategories: {},
    vendorPaymentMethods: {},
    workCategories: [],
    lastWorkHours: '8',
    lastWorkStatus: 'Draft',
    lastMileageRoute: null,
  };
}

function normalizeRoutePoint(point) {
  return {
    lat: Number(point?.lat || 0),
    lng: Number(point?.lng || 0),
    accuracy: Number(point?.accuracy || 0),
    timestamp: point?.timestamp || new Date().toISOString(),
  };
}

function normalizePlace(place) {
  if (!place || !Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lng))) return null;
  return {
    id: place.id || `${place.lat},${place.lng}`,
    label: place.label || '',
    lat: Number(place.lat),
    lng: Number(place.lng),
    city: place.city || '',
    state: place.state || '',
    postcode: place.postcode || '',
  };
}

function normalizeSavedMileageLocation(location) {
  const place = normalizePlace(location?.place || location);
  return {
    id: location?.id || newId(),
    label: location?.label || location?.type || 'Location',
    type: mileageLocationTypes.includes(location?.type) ? location.type : 'custom',
    address: location?.address || place?.label || '',
    place,
  };
}

function savedLocationById(id) {
  return savedMileageLocations.value.find((location) => location.id === id) || null;
}

function savedLocationByType(...types) {
  return savedMileageLocations.value.find((location) => types.includes(location.type)) || null;
}

function savedLocationPlace(location) {
  return normalizePlace(location?.place || location);
}

function normalizeMileageRow(row) {
  const routePoints = Array.isArray(row?.routePoints)
    ? row.routePoints.map(normalizeRoutePoint).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    : [];
  const routeGeometry = Array.isArray(row?.routeGeometry)
    ? row.routeGeometry.map(normalizeRoutePoint).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    : [];

  return {
    ...row,
    trackingMode: row?.trackingMode || (routePoints.length ? 'gps' : 'manual'),
    calculationMode: row?.calculationMode || (routeGeometry.length ? 'address-route' : routePoints.length ? 'gps' : 'manual'),
    routePoints,
    routeGeometry,
    fromPlace: normalizePlace(row?.fromPlace),
    toPlace: normalizePlace(row?.toPlace),
    routeDistanceMiles: Number(row?.routeDistanceMiles || 0),
    distanceMiles: Number(row?.distanceMiles || row?.miles || 0),
    durationSeconds: Number(row?.durationSeconds || 0),
    pausedSeconds: Number(row?.pausedSeconds || 0),
    pauseSegments: Array.isArray(row?.pauseSegments) ? row.pauseSegments : [],
    startLocation: row?.startLocation || '',
    endLocation: row?.endLocation || '',
  };
}

function normalizeProjectData(sourceData) {
  const blank = blankProjectData();
  const source = sourceData && typeof sourceData === 'object' ? sourceData : {};
  return {
    meta: { ...blank.meta, ...(source.meta || {}) },
    report: { ...blank.report, ...(source.report || {}) },
    expenseRows: Array.isArray(source.expenseRows) ? source.expenseRows : [],
    mileageRows: Array.isArray(source.mileageRows) ? source.mileageRows.map(normalizeMileageRow) : [],
    workLogs: Array.isArray(source.workLogs) ? source.workLogs : [],
    receipts: Array.isArray(source.receipts) ? source.receipts : [],
  };
}

function normalizeProject(project) {
  const fallback = blankProject();
  const status = ['active', 'archived', 'deleted'].includes(project?.status) ? project.status : 'active';
  return {
    ...fallback,
    ...project,
    id: project?.id || project?._id || fallback.id,
    siteId: project?.siteId || 'default',
    memberId: project?.memberId || '',
    createdBy: project?.createdBy || '',
    updatedBy: project?.updatedBy || '',
    title: project?.title || fallback.title,
    status,
    data: normalizeProjectData(project?.data),
  };
}

function applyAccountToProject(project = state.currentProject) {
  if (!project?.data?.report || !state.auth.member) return project;
  const owner = project.memberId ? membersById.value.get(project.memberId) : null;
  const member = state.auth.member.role === 'member' ? state.auth.member : owner;
  if (!member) return project;
  project.data.report.employeeId = member.accountNumber || project.data.report.employeeId;
  project.data.report.employeeName ||= member.name || '';
  project.data.report.phone ||= member.phone || '';
  project.data.report.email ||= member.email || '';
  return project;
}

function memberName(memberId) {
  const member = membersById.value.get(memberId);
  return member ? `${member.name || 'Member'} #${member.accountNumber}` : 'Unassigned';
}

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isDeviceDraft(project) {
  return project?.id?.startsWith('local-') || project?.id?.startsWith(deviceDraftPrefix);
}

function deviceDraftProjects() {
  return state.projects.filter(isDeviceDraft);
}

function projectHasUserData(project) {
  const projectData = project?.data || {};
  const projectReport = projectData.report || {};
  return Boolean(
    Object.values(projectReport).some((value) => value !== '' && value !== 0 && value != null) ||
      projectData.expenseRows?.length ||
      projectData.mileageRows?.length ||
      projectData.workLogs?.length ||
      projectData.receipts?.length
  );
}

function projectDataSignature(project) {
  return JSON.stringify(normalizeProject(project).data);
}

function projectTitleBase(project) {
  return (project?.title || projectTitle(project)).replace(/\s+\(device draft\)$/, '').trim() || 'Untitled expense project';
}

function isPersistedMongoProject(project) {
  return Boolean(project?.id && /^[a-f\d]{24}$/i.test(project.id) && !isDeviceDraft(project));
}

function deviceDraftId(project) {
  if (project.id?.startsWith(deviceDraftPrefix)) return project.id;
  return project.id?.startsWith('local-') ? project.id : `${deviceDraftPrefix}${project.id || newId()}`;
}

function asDeviceDraft(project) {
  const originalProjectId = project.originalProjectId || (project.id?.startsWith(deviceDraftPrefix) ? project.id.slice(deviceDraftPrefix.length) : project.id);
  const title = projectTitleBase(project);
  return {
    ...normalizeProject(project),
    id: deviceDraftId(project),
    title: `${title} (device draft)`,
    originalProjectId,
  };
}

function projectIdentityKey(project) {
  const normalized = normalizeProject(project);
  const signature = projectDataSignature(normalized);
  const originalProjectId = normalized.originalProjectId && !normalized.originalProjectId.startsWith('local-') ? normalized.originalProjectId : '';
  const sourceId = originalProjectId || (isPersistedMongoProject(normalized) ? normalized.id : '');
  return sourceId ? `${sourceId}:${signature}` : `${projectTitleBase(normalized).toLowerCase()}:${signature}`;
}

function projectDraftDuplicateKey(project) {
  const normalized = normalizeProject(project);
  return `${projectTitleBase(normalized).toLowerCase()}:${projectDataSignature(normalized)}`;
}

function uniqueProjects(projects) {
  const seen = new Set();
  return projects.filter((project) => {
    const normalized = normalizeProject(project);
    const key = isDeviceDraft(normalized) ? projectDraftDuplicateKey(normalized) : projectIdentityKey(normalized);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findDeviceDrafts(localProjects, cloudProjects) {
  const cloudSignatures = new Map(cloudProjects.map((project) => [project.id, projectDataSignature(project)]));
  const cloudSignatureSet = new Set(cloudProjects.map(projectDataSignature));
  const seenDrafts = new Set();
  return uniqueProjects(
    localProjects
      .filter(projectHasUserData)
      .filter((project) => {
        const normalized = normalizeProject(project);
        const signature = projectDataSignature(normalized);
        const originalProjectId = normalized.originalProjectId && !normalized.originalProjectId.startsWith('local-') ? normalized.originalProjectId : '';
        const matchingCloudSignature = cloudSignatures.get(originalProjectId || normalized.id);
        if (matchingCloudSignature === signature || cloudSignatureSet.has(signature)) return false;
        return isDeviceDraft(normalized) || cloudSignatures.get(normalized.id) !== signature;
      })
      .map(asDeviceDraft)
      .filter((project) => {
        const key = projectDraftDuplicateKey(project);
        if (seenDrafts.has(key)) return false;
        seenDrafts.add(key);
        return true;
      })
  ).map(normalizeProject);
}

function uniqueDeviceDrafts(projects) {
  const seen = new Set();
  return projects.filter((project) => {
    const key = projectDraftDuplicateKey(project);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function removeSyncedDeviceDraftBackups(projects) {
  const syncedKeys = new Set(projects.map(projectIdentityKey));
  if (!syncedKeys.size) return;

  try {
    const existing = JSON.parse(localStorage.getItem(archiveBackupStorageKey) || '[]');
    const backups = Array.isArray(existing) ? existing : [];
    const cleaned = backups
      .map((backup) => ({
        ...backup,
        projects: (Array.isArray(backup.projects) ? backup.projects : []).filter((project) => !syncedKeys.has(projectIdentityKey(project))),
      }))
      .filter((backup) => backup.projects.length);
    localStorage.setItem(archiveBackupStorageKey, JSON.stringify(cleaned));
  } catch {
    // Best effort cleanup only.
  }
}

function refreshReceiptQueue() {
  state.receiptQueue = (state.currentProject?.data?.receipts || [])
    .filter((receipt) => receipt.pendingUpload)
    .map((receipt) => ({
      id: receipt.id,
      vendor: receipt.vendor || 'Receipt',
      amount: Number(receipt.amount || 0),
      reason: receipt.pendingReason || 'Pending cloud upload',
      createdAt: receipt.createdAt || '',
    }));
}

function projectTitle(project = state.currentProject) {
  if (!project) return 'Untitled expense project';
  const projectReport = project.data?.report || {};
  const pieces = [
    projectReport.reportNo ? `Report ${projectReport.reportNo}` : '',
    projectReport.employeeName || projectReport.engagement || '',
    projectReport.periodFrom && projectReport.periodTo ? `${projectReport.periodFrom} to ${projectReport.periodTo}` : '',
  ].filter(Boolean);
  return project.title || pieces.join(' - ') || 'Untitled expense project';
}

function categoryTotals(rows) {
  return categories.reduce((totals, category) => {
    totals[category] = rows
      .filter((row) => row.category === category)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return totals;
  }, {});
}

function receiptForExpenseRow(row) {
  return data.value.receipts.find((receipt) => receipt.expenseId === row.id || receipt.id === row.receiptId) || null;
}

function receiptReferenceForExpenseRow(row, index = data.value.expenseRows.findIndex((expense) => expense.id === row.id)) {
  const receipt = receiptForExpenseRow(row);
  const rowNumber = index >= 0 ? index + 1 : '';
  if (receipt) return `Receipt ${rowNumber || receipt.id}`;
  return row.receiptId ? `Receipt ${row.receiptId}` : 'Missing receipt';
}

function mileageRateSummary() {
  const rates = [...new Set(data.value.mileageRows.map((row) => Number(row.rate || 0)).filter(Boolean))];
  if (!rates.length) return '$0.000';
  if (rates.length === 1) return `$${mileageRate.format(rates[0])}`;
  return 'Mixed rates';
}

function workLogGroupLabel(row) {
  const raw = row.taskCategory || row.status || 'Work log';
  if (/remote/i.test(raw)) return 'Remote work';
  if (/onsite|on-site|site|field/i.test(raw)) return 'Onsite work';
  return raw;
}

function summarizeWorkLogs(rows = []) {
  const groups = new Map();
  rows.forEach((row) => {
    const label = workLogGroupLabel(row);
    const existing = groups.get(label) || { label, dates: [], entries: 0, hours: 0, summary: '' };
    if (row.date) existing.dates.push(row.date);
    existing.entries += 1;
    existing.hours += Number(row.hours || 0);
    if (!existing.summary && row.summary) existing.summary = row.summary;
    groups.set(label, existing);
  });
  return [...groups.values()].map((group) => {
    const sortedDates = [...new Set(group.dates)].sort();
    return {
      ...group,
      dateRange: sortedDates.length > 1 ? `${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}` : sortedDates[0] || '',
    };
  });
}

function loadEntryDefaults() {
  try {
    const parsed = JSON.parse(localStorage.getItem(entryDefaultsStorageKey) || '{}');
    return normalizeEntryDefaults(parsed);
  } catch {
    return blankEntryDefaults();
  }
}

function normalizeEntryDefaults(defaults) {
  const blank = blankEntryDefaults();
  const source = defaults && typeof defaults === 'object' ? defaults : {};
  return {
    ...blank,
    ...source,
    mileageRate: source.mileageRate || blank.mileageRate,
    recentVendors: Array.isArray(source.recentVendors) ? source.recentVendors.slice(0, 12) : [],
    vendorCategories: source.vendorCategories && typeof source.vendorCategories === 'object' ? source.vendorCategories : {},
    vendorPaymentMethods: source.vendorPaymentMethods && typeof source.vendorPaymentMethods === 'object' ? source.vendorPaymentMethods : {},
    workCategories: Array.isArray(source.workCategories) ? source.workCategories.slice(0, 12) : [],
    lastWorkHours: source.lastWorkHours || blank.lastWorkHours,
    lastWorkStatus: source.lastWorkStatus || blank.lastWorkStatus,
    lastMileageRoute: source.lastMileageRoute || null,
  };
}

function saveEntryDefaults() {
  localStorage.setItem(entryDefaultsStorageKey, JSON.stringify(state.entryDefaults));
}

function vendorKey(vendor) {
  return String(vendor || '').trim().toLowerCase();
}

function rememberRecent(list, value, limit = 12) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return list || [];
  return [trimmed, ...(list || []).filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, limit);
}

function updateEntryDefaultsFromProject(project = state.currentProject) {
  const projectData = project?.data || data.value;
  const projectMeta = projectData.meta || {};
  const projectReport = projectData.report || {};
  Object.assign(state.entryDefaults, {
    employeeName: projectReport.employeeName || state.entryDefaults.employeeName,
    address: projectReport.address || state.entryDefaults.address,
    employeeId: projectReport.employeeId || state.entryDefaults.employeeId,
    phone: projectReport.phone || state.entryDefaults.phone,
    email: projectReport.email || state.entryDefaults.email,
    clientName: projectMeta.clientName || state.entryDefaults.clientName,
    siteName: projectMeta.siteName || state.entryDefaults.siteName,
    siteAddress: projectMeta.siteAddress || state.entryDefaults.siteAddress,
    startAddress: projectReport.address || state.entryDefaults.startAddress,
    billingContact: projectMeta.billingContact || state.entryDefaults.billingContact,
    billingEmail: projectMeta.billingEmail || state.entryDefaults.billingEmail,
  });
  saveEntryDefaults();
}

function updateEntryDefaultsFromExpense(row, receipt = null) {
  const key = vendorKey(row.vendor);
  if (key) {
    state.entryDefaults.recentVendors = rememberRecent(state.entryDefaults.recentVendors, row.vendor);
    state.entryDefaults.vendorCategories[key] = row.category || state.entryDefaults.vendorCategories[key] || 'Misc.';
    if (receipt?.paymentMethod) state.entryDefaults.vendorPaymentMethods[key] = receipt.paymentMethod;
  }
  saveEntryDefaults();
}

function updateEntryDefaultsFromMileage(row) {
  if (row.rate) state.entryDefaults.mileageRate = String(row.rate);
  state.entryDefaults.lastMileageRoute = {
    from: row.from || '',
    to: row.to || '',
    purpose: row.purpose || '',
    fromPlace: row.fromPlace || null,
    toPlace: row.toPlace || null,
    routeGeometry: row.routeGeometry || [],
    routeDistanceMiles: row.routeDistanceMiles || row.miles || 0,
    routeDurationSeconds: row.routeDurationSeconds || row.durationSeconds || 0,
    calculationMode: row.calculationMode || 'manual',
  };
  saveEntryDefaults();
}

function updateEntryDefaultsFromWorkLog(row) {
  if (row.clientSite) state.entryDefaults.clientName = row.clientSite;
  if (row.location) state.entryDefaults.siteName = row.location;
  state.entryDefaults.workCategories = rememberRecent(state.entryDefaults.workCategories, row.taskCategory);
  if (row.hours) state.entryDefaults.lastWorkHours = String(row.hours);
  if (row.status) state.entryDefaults.lastWorkStatus = row.status;
  saveEntryDefaults();
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

function dateInsideRange(date, from, to) {
  if (!isValidDateInput(date)) return true;
  if (isValidDateInput(from) && date < from) return false;
  if (isValidDateInput(to) && date > to) return false;
  return true;
}

function dateIsWeekday(value) {
  if (!isValidDateInput(value)) return false;
  const day = new Date(`${value}T00:00:00`).getDay();
  return day !== 0 && day !== 6;
}

function addDaysInput(value, days) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return currentDateInputValue(date);
}

function nextWeekdayInPeriod(afterDate = '') {
  return nextAvailableWorkLogDate({
    afterDate,
    periodFrom: report.value.periodFrom,
    periodTo: report.value.periodTo,
    existingDates: data.value.workLogs.map((row) => row.date),
    today: currentDateInputValue(),
  });
}

function inferWorkCategoryForDate(date) {
  return inferWorkTypeForDate(date, report.value, state.entryDefaults.workCategories[0]);
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

function applyProjectDefaults(project) {
  const target = normalizeProject(project);
  const targetMeta = target.data.meta;
  const targetReport = target.data.report;
  const defaults = state.entryDefaults;
  targetMeta.clientName ||= defaults.clientName;
  targetMeta.siteName ||= defaults.siteName;
  targetMeta.siteAddress ||= defaults.siteAddress;
  targetMeta.billingContact ||= defaults.billingContact;
  targetMeta.billingEmail ||= defaults.billingEmail;
  targetReport.employeeName ||= defaults.employeeName;
  targetReport.address ||= defaults.address || defaults.startAddress;
  targetReport.employeeId ||= defaults.employeeId;
  targetReport.phone ||= defaults.phone;
  targetReport.email ||= defaults.email;
  targetReport.reportDate ||= currentDateInputValue();
  targetReport.reportNo ||= suggestNextSequence(state.projects.map((item) => item.data?.report?.reportNo));
  targetMeta.invoiceNumber ||= suggestNextSequence(state.projects.map((item) => item.data?.meta?.invoiceNumber));
  return target;
}

function seedMileageForm() {
  Object.assign(mileageForm, {
    date: data.value.workLogs[data.value.workLogs.length - 1]?.date || currentDateInputValue(),
    from: state.entryDefaults.startAddress || report.value.address || '',
    to: '',
    purpose: '',
    miles: '',
    rate: state.entryDefaults.mileageRate || '0.725',
    fromSavedLocationId: '',
    toSavedLocationId: '',
    fromPlace: null,
    toPlace: null,
    routeGeometry: [],
    routeDistanceMiles: 0,
    routeDurationSeconds: 0,
    calculationMode: 'manual',
  });
}

function seedWorkLogForm(afterDate = '') {
  const nextDate = nextWeekdayInPeriod(afterDate || data.value.workLogs[data.value.workLogs.length - 1]?.date || '');
  const workType = inferWorkCategoryForDate(nextDate);
  const clientSite = meta.value.clientName || meta.value.siteName || state.entryDefaults.clientName;
  const hours = state.entryDefaults.lastWorkHours || '8';
  Object.assign(workLogForm, {
    date: nextDate,
    clientSite,
    location: workLogLocationForType(workType, meta.value, state.entryDefaults),
    taskCategory: workType,
    hours,
    hourPreset: workLogHourOptions.includes(hours) ? hours : 'Custom',
    summary: '',
    actions: '',
    status: state.entryDefaults.lastWorkStatus || 'Draft',
    showDetails: false,
  });
}

function buildProjectReviewItems(projectData) {
  const items = [];
  const required = [
    ['missing', 'Client name is missing', projectData.meta.clientName],
    ['missing', 'Employee name is missing', projectData.report.employeeName],
    ['missing', 'Invoice/report number is missing', projectData.meta.invoiceNumber || projectData.report.reportNo],
    ['missing', 'Report date is missing', projectData.report.reportDate],
    ['missing', 'Period start is missing', projectData.report.periodFrom],
    ['missing', 'Period end is missing', projectData.report.periodTo],
  ];
  required.forEach(([type, label, value]) => {
    if (!value) items.push({ type, label });
  });

  projectData.expenseRows.forEach((row) => {
    const hasReceipt = row.receiptId || projectData.receipts.some((receipt) => receipt.expenseId === row.id || receipt.id === row.receiptId);
    if (!hasReceipt) items.push({ type: 'warning', label: `Expense missing receipt: ${row.vendor || row.description || row.date || 'Untitled expense'}` });
  });

  projectData.workLogs.forEach((row) => {
    if (!dateInsideRange(row.date, projectData.report.periodFrom, projectData.report.periodTo)) {
      items.push({ type: 'warning', label: `Work log date outside period: ${row.date}` });
    }
    if (!projectData.mileageRows.some((mileage) => mileage.date === row.date)) {
      items.push({ type: 'warning', label: `Work log has no mileage for ${row.date}` });
    }
  });

  projectData.mileageRows.forEach((row) => {
    if (!dateInsideRange(row.date, projectData.report.periodFrom, projectData.report.periodTo)) {
      items.push({ type: 'warning', label: `Mileage date outside period: ${row.date}` });
    }
  });

  [
    ['Onsite', projectData.report.onsiteFrom, projectData.report.onsiteTo, projectData.report.onsiteDays],
    ['Remote', projectData.report.remoteFrom, projectData.report.remoteTo, projectData.report.remoteDays],
  ].forEach(([label, from, to, days]) => {
    const expected = weekdayCountInRange(from, to);
    if (expected && Number(days || 0) !== expected) {
      items.push({ type: 'warning', label: `${label} day count is ${days || 0}; weekday range is ${expected}` });
    }
  });

  return items;
}

function loadLocalArchive() {
  try {
    const parsed = JSON.parse(localStorage.getItem(archiveStorageKey) || '{}');
    const backups = JSON.parse(localStorage.getItem(archiveBackupStorageKey) || '[]');
    const backupProjects = Array.isArray(backups)
      ? backups.flatMap((backup) => (Array.isArray(backup.projects) ? backup.projects : []))
      : [];
    const projects = uniqueProjects([...(Array.isArray(parsed.projects) ? parsed.projects : []), ...backupProjects]).map(normalizeProject);
    return { projects, currentProjectId: parsed.currentProjectId || projects[0]?.id || '' };
  } catch {
    return { projects: [], currentProjectId: '' };
  }
}

function preserveDeviceDrafts(projects) {
  const drafts = uniqueDeviceDrafts(projects.filter(projectHasUserData).map(asDeviceDraft));
  if (!drafts.length) return;

  const existing = JSON.parse(localStorage.getItem(archiveBackupStorageKey) || '[]');
  const backups = Array.isArray(existing) ? existing : [];
  const existingDrafts = backups.flatMap((backup) => (Array.isArray(backup.projects) ? backup.projects : []));
  const newDrafts = uniqueDeviceDrafts([...drafts, ...existingDrafts]).slice(0, 20);
  backups.unshift({
    savedAt: new Date().toISOString(),
    projects: newDrafts,
  });
  localStorage.setItem(
    archiveBackupStorageKey,
    JSON.stringify(
      backups
        .map((backup, index) => (index === 0 ? backup : { ...backup, projects: uniqueDeviceDrafts(backup.projects || []) }))
        .filter((backup) => backup.projects.length)
        .slice(0, 5)
    )
  );
}

function persistLocalArchive(updateStatus = true) {
  try {
    const existing = JSON.parse(localStorage.getItem(archiveStorageKey) || '{}');
    const existingProjects = Array.isArray(existing.projects) ? existing.projects : [];
    const currentKeys = new Set(state.projects.map(projectIdentityKey));
    const currentSignatures = new Set(state.projects.map(projectDataSignature));
    const draftsToPreserve = existingProjects.filter(
      (project) => projectHasUserData(project) && !currentKeys.has(projectIdentityKey(project)) && !currentSignatures.has(projectDataSignature(project))
    );
    preserveDeviceDrafts(draftsToPreserve);
  } catch {
    // Best effort backup only.
  }

  localStorage.setItem(
    archiveStorageKey,
    JSON.stringify({
      projects: state.projects,
      currentProjectId: state.currentProject?.id || '',
    })
  );
  if (updateStatus) {
    state.lastSavedAt = new Date().toISOString();
    state.lastSaveStatus = state.storage === 'mongodb' ? 'Cached locally' : 'Saved locally';
  }
}

function flushLocalArchive(updateStatus = true) {
  if (localArchiveTimer) {
    clearTimeout(localArchiveTimer);
    localArchiveTimer = null;
  }
  persistLocalArchive(updateStatus);
}

function flushLocalArchiveBeforeUnload() {
  flushLocalArchive(false);
}

function saveLocalArchive(options = {}) {
  const config = options && typeof options === 'object' ? options : {};
  if (config.defer) {
    if (localArchiveTimer) clearTimeout(localArchiveTimer);
    if (config.updateStatus !== false) {
      state.lastSavedAt = new Date().toISOString();
      state.lastSaveStatus = state.storage === 'mongodb' ? 'Cached locally' : 'Saved locally';
    }
    localArchiveTimer = setTimeout(() => {
      localArchiveTimer = null;
      persistLocalArchive(config.updateStatus !== false);
    }, localArchiveDelayMs);
    return;
  }

  flushLocalArchive(config.updateStatus !== false);
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'API request failed.');
  }
  return payload;
}

async function loadProjects() {
  state.loading = true;
  state.error = '';
  state.recoveryStatus = '';
  const localArchive = loadLocalArchive();

  try {
    const payload = await apiJson('/api/projects');
    const cloudProjects = payload.projects.map(normalizeProject);

    state.projects = cloudProjects.map(normalizeProject);
    state.storage = 'mongodb';

    const nonDeletedProjects = cloudProjects.filter((project) => project.status !== 'deleted');
    if (!nonDeletedProjects.length) {
      await createProject('Untitled expense project');
    } else {
      const preferred = nonDeletedProjects.find((project) => project.id === localArchive.currentProjectId) || nonDeletedProjects[0];
      await openProject(preferred.id);
    }
  } catch (error) {
    if (/sign in/i.test(error.message)) {
      state.auth.authenticated = false;
      state.auth.member = null;
      state.auth.loginError = 'Please sign in again.';
      state.loading = false;
      return;
    }
    state.projects = localArchive.projects.length ? localArchive.projects : [blankProject()];
    state.currentProject = state.projects.find((project) => project.id === localArchive.currentProjectId) || state.projects[0];
    refreshReceiptQueue();
    seedMileageForm();
    seedWorkLogForm();
    state.storage = 'local';
    state.error = 'Using local fallback. MongoDB sync is unavailable in this session.';
    saveLocalArchive();
  } finally {
    state.loading = false;
  }
}

function recheckDeviceDrafts() {
  const localArchive = loadLocalArchive();
  const cloudProjects = state.projects.filter((project) => !isDeviceDraft(project));
  const deviceDrafts = findDeviceDrafts(localArchive.projects, cloudProjects);
  state.projects = uniqueProjects([...cloudProjects, ...deviceDrafts]).map(normalizeProject);

  if (deviceDrafts.length) {
    state.error = `${deviceDrafts.length} device draft${deviceDrafts.length === 1 ? '' : 's'} found.`;
    state.recoveryStatus = 'Device drafts are available. Tap the green sync button to upload them to MongoDB.';
    const preferredDraft = deviceDrafts.find((project) => project.originalProjectId === localArchive.currentProjectId || project.id === localArchive.currentProjectId) || deviceDrafts[0];
    state.currentProject = preferredDraft;
  } else {
    state.recoveryStatus = 'No device drafts were found in this browser storage. MongoDB cloud sync is active.';
  }

  saveLocalArchive();
}

async function createProject(title = 'Untitled expense project') {
  if (state.storage === 'mongodb') {
    const payload = await apiJson('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    const project = applyAccountToProject(applyProjectDefaults(payload.project));
    state.projects = [project, ...state.projects];
    state.currentProject = project;
    seedMileageForm();
    seedWorkLogForm();
    state.mileageDrafts = [];
    refreshReceiptQueue();
    await saveCurrentProject();
    return;
  }

  const project = applyProjectDefaults(blankProject(title));
  state.projects.unshift(project);
  state.currentProject = project;
  seedMileageForm();
  seedWorkLogForm();
  state.mileageDrafts = [];
  saveLocalArchive();
}

async function openProject(id) {
  stopGpsTripWatcher();
  if (state.storage === 'mongodb' && !isDeviceDraft({ id })) {
    const payload = await apiJson(`/api/projects/${id}`);
    state.currentProject = applyAccountToProject(normalizeProject(payload.project));
    const index = state.projects.findIndex((project) => project.id === state.currentProject.id);
    if (index >= 0) state.projects[index] = { ...state.projects[index], ...state.currentProject };
    refreshReceiptQueue();
    seedMileageForm();
    seedWorkLogForm();
    state.mileageDrafts = [];
    saveLocalArchive();
    return;
  }

  state.currentProject = state.projects.find((project) => project.id === id) || state.projects[0];
  applyAccountToProject();
  refreshReceiptQueue();
  seedMileageForm();
  seedWorkLogForm();
  state.mileageDrafts = [];
  saveLocalArchive();
}

function clearAutosaveTimer() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

function scheduleAutoSave() {
  if (!state.currentProject || state.loading) return;
  clearAutosaveTimer();
  state.lastSaveStatus = 'Autosave pending...';
  state.saveNotice = '';
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    saveCurrentProject({ autosave: true });
  }, autosaveDelayMs);
}

async function saveCurrentProject(options = {}) {
  const config = options && typeof options === 'object' ? options : {};
  if (!state.currentProject) return;
  if (config.autosave && state.saving) {
    scheduleAutoSave();
    return;
  }

  state.currentProject.title = projectTitle();
  applyAccountToProject();
  state.currentProject.updatedAt = new Date().toISOString();
  const index = state.projects.findIndex((project) => project.id === state.currentProject.id);
  if (index >= 0) state.projects[index] = state.currentProject;

  if (config.requireCloud && isDeviceDraft(state.currentProject)) {
    await saveDeviceDraftToMongo(config);
    return;
  }

  const shouldAttemptCloud = (state.storage === 'mongodb' || isPersistedMongoProject(state.currentProject)) && !isDeviceDraft(state.currentProject);
  if (!shouldAttemptCloud) {
    updateEntryDefaultsFromProject();
    saveLocalArchive({ defer: Boolean(config.autosave) });
    if (config.requireCloud) {
      state.error = 'Saved on this device. Cloud save is unavailable right now.';
      state.lastSaveStatus = 'Saved locally';
      state.saveNotice = `Saved locally at ${formatDateTime(new Date())}`;
    } else if (config.autosave) {
      state.lastSaveStatus = 'Autosaved locally';
      state.saveNotice = `Autosaved locally at ${formatDateTime(new Date())}`;
    }
    return;
  }

  try {
    state.saving = true;
    if (config.autosave) state.lastSaveStatus = 'Autosaving...';
    const projectId = state.currentProject.id;
    const requestData = normalizeProjectData(state.currentProject.data);
    const expectedSignature = projectDataSignature({ id: projectId, data: requestData });
    const payload = await apiJson(`/api/projects/${state.currentProject.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: state.currentProject.title,
        data: requestData,
      }),
    });
    if (payload.storage !== 'mongodb' || payload.saved !== true) {
      throw new Error('MongoDB save was not confirmed by the server.');
    }

    const successStatus = config.autosave ? 'Autosaved' : 'Saved successfully';
    if (config.verifyCloud) {
      const confirmed = await apiJson(`/api/projects/${projectId}`);
      if (confirmed.storage !== 'mongodb' || projectDataSignature(confirmed.project) !== expectedSignature) {
        throw new Error('MongoDB verification did not match the saved document.');
      }
    }

    state.currentProject = normalizeProject(payload.project);
    state.storage = 'mongodb';
    state.error = '';
    updateEntryDefaultsFromProject();
    saveLocalArchive({ updateStatus: false });
    state.lastSavedAt = new Date().toISOString();
    state.lastSaveStatus = successStatus;
    state.saveNotice = `${successStatus} at ${formatDateTime(state.lastSavedAt)}`;
  } catch (error) {
    if (!isPersistedMongoProject(state.currentProject)) state.storage = 'local';
    updateEntryDefaultsFromProject();
    saveLocalArchive({ updateStatus: false });
    state.error = `Saved locally only. MongoDB save failed: ${error.message}`;
    state.lastSaveStatus = 'MongoDB save failed';
    state.saveNotice = 'MongoDB save failed. Changes are cached on this device.';
  } finally {
    state.saving = false;
  }
}

async function saveDeviceDraftToMongo(config = {}) {
  const draft = state.currentProject;
  if (!draft) return;

  try {
    state.saving = true;
    const title = (draft.title || projectTitle(draft)).replace(/\s+\(device draft\)$/, '');
    const requestData = normalizeProjectData(draft.data);
    const expectedSignature = projectDataSignature({ id: draft.id, data: requestData });
    const targetId = draft.originalProjectId && !draft.originalProjectId.startsWith('local-') ? draft.originalProjectId : '';
    let saved;

    if (targetId) {
      saved = await apiJson(`/api/projects/${targetId}`, {
        method: 'PUT',
        body: JSON.stringify({ title, data: requestData }),
      }).catch(() => null);
    }

    if (!saved) {
      const created = await apiJson('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
      saved = await apiJson(`/api/projects/${created.project.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title, data: requestData }),
      });
    }

    if (saved.storage !== 'mongodb' || saved.saved !== true) {
      throw new Error('Cloud save was not confirmed by the server.');
    }

    if (config.verifyCloud) {
      const confirmed = await apiJson(`/api/projects/${saved.project.id}`);
      if (confirmed.storage !== 'mongodb' || projectDataSignature(confirmed.project) !== expectedSignature) {
        throw new Error('Cloud verification did not match the saved document.');
      }
    }

    const savedProject = normalizeProject(saved.project);
    state.projects = [savedProject, ...state.projects.filter((project) => project.id !== draft.id && project.id !== savedProject.id)];
    state.currentProject = savedProject;
    state.storage = 'mongodb';
    state.error = '';
    refreshReceiptQueue();
    updateEntryDefaultsFromProject();
    saveLocalArchive({ updateStatus: false });
    state.lastSavedAt = new Date().toISOString();
    state.lastSaveStatus = 'Saved successfully';
    state.saveNotice = `Saved successfully at ${formatDateTime(state.lastSavedAt)}`;
  } catch (error) {
    saveLocalArchive({ updateStatus: false });
    state.error = `Saved locally only. Cloud save failed: ${error.message}`;
    state.lastSaveStatus = 'Cloud save failed';
    state.saveNotice = 'Cloud save failed. Changes are cached on this device.';
  } finally {
    state.saving = false;
  }
}

async function saveDetailsToMongo() {
  clearAutosaveTimer();
  await saveCurrentProject({ requireCloud: true, verifyCloud: true });
}

async function syncLocalProjectsToCloud() {
  const localProjects = uniqueDeviceDrafts(deviceDraftProjects());
  if (!localProjects.length) return;

  state.syncingLocal = true;
  try {
    const replacements = new Map();
    for (const project of localProjects) {
      const title = projectTitleBase(project);
      const targetId = project.originalProjectId && !project.originalProjectId.startsWith('local-') ? project.originalProjectId : '';
      let saved;
      if (targetId) {
        saved = await apiJson(`/api/projects/${targetId}`, {
          method: 'PUT',
          body: JSON.stringify({
            title,
            data: project.data,
          }),
        }).catch(() => null);
      }
      if (!saved) {
        const created = await apiJson('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ title }),
        });
        saved = await apiJson(`/api/projects/${created.project.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            title,
            data: project.data,
          }),
        });
      }
      replacements.set(project.id, normalizeProject(saved.project));
    }

    const currentId = state.currentProject?.id || '';
    const syncedDraftIds = new Set(localProjects.map((project) => project.id));
    const replacementProjects = [...replacements.values()];
    state.projects = uniqueProjects([
      ...replacementProjects,
      ...state.projects.filter((project) => !syncedDraftIds.has(project.id) && !replacementProjects.some((replacement) => replacement.id === project.id)),
    ]).map(normalizeProject);
    removeSyncedDeviceDraftBackups([...localProjects, ...replacementProjects]);
    const replacement = replacements.get(currentId);
    if (replacement) {
      await openProject(replacement.id);
    } else {
      saveLocalArchive();
    }
    state.error = 'Device drafts synced to cloud and duplicate local copies were cleaned up.';
    state.recoveryStatus = '';
  } catch (error) {
    state.error = `Local project sync failed: ${error.message}`;
  } finally {
    state.syncingLocal = false;
  }
}

function backupFileName() {
  const stamp = new Date().toISOString().slice(0, 10);
  return `wls-project-backup-${stamp}.json`;
}

function safeFileName(name, fallback = 'export') {
  return (name || fallback).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || fallback;
}

function downloadTextFile(fileName, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  downloadBlobFile(fileName, blob);
}

function downloadBlobFile(fileName, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function clearCrudUndo() {
  state.undo = null;
}

function setCrudUndo(undo, fallbackLabel = 'Change can be undone.') {
  state.undo = undo ? { ...undo, label: undo.label || fallbackLabel } : null;
}

async function undoLastCrudAction() {
  if (!state.undo || !state.currentProject) return;
  const undo = state.undo;
  state.currentProject.data = normalizeProjectData(restoreUndoItems(data.value, undo));
  refreshReceiptQueue();
  if (undo.selectedMileageId) state.gps.selectedMileageId = undo.selectedMileageId;
  state.undo = null;
  await saveCurrentProject();
}

function editingLabel(type) {
  const id = state.editing[`${type}Id`];
  if (!id) return '';
  const collections = { expense: data.value.expenseRows, mileage: data.value.mileageRows, workLog: data.value.workLogs };
  const index = (collections[type] || []).findIndex((row) => row.id === id);
  return index >= 0 ? `Editing row #${index + 1}` : 'Editing row';
}

function cancelExpenseEdit() {
  state.editing.expenseId = '';
  Object.assign(expenseForm, { date: currentDateInputValue(), vendor: '', description: '', category: 'Hotel', amount: '' });
}

function cancelMileageEdit() {
  state.editing.mileageId = '';
  resetMileageForm();
}

function cancelWorkLogEdit() {
  state.editing.workLogId = '';
  seedWorkLogForm();
}

function exportJsonBackup() {
  const payload = {
    app: 'WLS Expense & Invoice Tracker',
    exportedAt: new Date().toISOString(),
    storage: state.storage,
    projects: state.projects.map(normalizeProject),
    currentProjectId: state.currentProject?.id || '',
  };
  downloadTextFile(backupFileName(), JSON.stringify(payload, null, 2), 'application/json');
}

function openBackupImport() {
  backupFileInput.value?.click();
}

async function importJsonBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const importedProjects = Array.isArray(payload.projects) ? payload.projects.map(asDeviceDraft) : [];
    if (!importedProjects.length) throw new Error('No projects found in backup.');
    const cloudProjects = state.projects.filter((project) => !isDeviceDraft(project));
    state.projects = uniqueProjects([...cloudProjects, ...importedProjects]).map(normalizeProject);
    state.currentProject = importedProjects[0];
    state.recoveryStatus = `${importedProjects.length} backup project${importedProjects.length === 1 ? '' : 's'} imported as device drafts. Sync them to cloud when ready.`;
    saveLocalArchive();
  } catch (error) {
    state.error = `Backup import failed: ${error.message}`;
  } finally {
    event.target.value = '';
  }
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function quickBooksInvoiceRows() {
  const invoiceNumber = meta.value.invoiceNumber || report.value.reportNo || '';
  const invoiceDate = report.value.reportDate || new Date().toISOString().slice(0, 10);
  const customer = meta.value.clientName || meta.value.billingContact || 'Customer';
  const rows = [
    ['Invoice No', 'Customer', 'Invoice Date', 'Product/Service', 'Description', 'Qty', 'Rate', 'Amount', 'Project'],
    ...statementLaborRows.value.map((row) => [
      invoiceNumber,
      customer,
      invoiceDate,
      row.label,
      [row.date, row.description].filter(Boolean).join(' | '),
      row.days,
      row.rate,
      Number(row.days || 0) * Number(row.rate || 0),
      projectTitle(),
    ]),
  ];

  if (expenseTotal.value) {
    rows.push([invoiceNumber, customer, invoiceDate, 'Reimbursable Expenses', 'Expense report total', 1, expenseTotal.value, expenseTotal.value, projectTitle()]);
  }

  if (mileageTotal.value) {
    rows.push([
      invoiceNumber,
      customer,
      invoiceDate,
      'Mileage Reimbursement',
      `${number.format(totalMiles.value)} miles`,
      1,
      mileageTotal.value,
      mileageTotal.value,
      projectTitle(),
    ]);
  }

  return rows;
}

function quickBooksExpenseRows() {
  return [
    ['Date', 'Payee', 'Category', 'Description', 'Amount', 'Payment Method', 'Project', 'Receipt ID'],
    ...data.value.expenseRows.map((row) => {
      const receipt = data.value.receipts.find((item) => item.expenseId === row.id || item.id === row.receiptId);
      return [
        row.date,
        row.vendor,
        row.category,
        row.description,
        Number(row.amount || 0),
        receipt?.paymentMethod || '',
        projectTitle(),
        receipt?.id || row.receiptId || '',
      ];
    }),
  ];
}

function exportQuickBooksInvoiceCsv() {
  downloadTextFile(`${safeFileName(projectTitle(), 'quickbooks-invoice')}-quickbooks-invoice.csv`, toCsv(quickBooksInvoiceRows()), 'text/csv');
}

function exportQuickBooksExpensesCsv() {
  downloadTextFile(`${safeFileName(projectTitle(), 'quickbooks-expenses')}-quickbooks-expenses.csv`, toCsv(quickBooksExpenseRows()), 'text/csv');
}

async function exportExcelPackage() {
  const excelModule = await import('exceljs');
  const ExcelJS = excelModule.default || excelModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WLS Expense & Invoice Tracker';
  workbook.created = new Date();
  workbook.modified = new Date();
  const logo = await imageToDataUrl(logoUrl).catch(() => '');
  const logoId = logo ? workbook.addImage({ base64: logo, extension: imageFormatForDataUrl(logo).toLowerCase() === 'png' ? 'png' : 'jpeg' }) : null;

  buildAccountingPackageSheet(workbook, logoId);
  buildExpenseDetailSheet(workbook);
  buildMileageDetailSheet(workbook);
  buildWorkLogSummarySheet(workbook);

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlobFile(
    `${safeFileName(projectTitle(), 'accounting-package')}.xlsx`,
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
}

function buildAccountingPackageSheet(workbook, logoId) {
  const sheet = workbook.addWorksheet('Accounting Package', {
    pageSetup: { orientation: 'landscape', paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 2 },
    views: [{ state: 'frozen', ySplit: 8 }],
  });
  sheet.columns = [
    { width: 16 },
    { width: 24 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
  ];
  if (logoId !== null) sheet.addImage(logoId, 'A1:B4');
  sheet.mergeCells('C1:H2');
  sheet.getCell('C1').value = 'Consolidated Statement';
  sheet.getCell('C1').font = { size: 20, bold: true, color: { argb: 'FF4B5A60' } };
  sheet.getCell('C1').alignment = { horizontal: 'right', vertical: 'middle' };

  const metaRows = [
    ['Invoice / Report', meta.value.invoiceNumber || report.value.reportNo || 'Not set', 'Report Date', report.value.reportDate || 'Not set'],
    ['Employee / Account', `${report.value.employeeName || 'Employee'}${report.value.employeeId ? ` #${report.value.employeeId}` : ''}`, 'Client', meta.value.clientName || 'Not set'],
    ['Job / PO', [meta.value.jobNumber, meta.value.poNumber].filter(Boolean).join(' / ') || 'Not set', 'Billing Period', formatPeriod() || 'Not set'],
  ];
  metaRows.forEach((row, index) => {
    sheet.getRow(5 + index).values = row;
  });
  styleExcelRange(sheet, 5, 7, 1, 4, { border: true });
  [5, 6, 7].forEach((rowNumber) => {
    [1, 3].forEach((column) => {
      sheet.getCell(rowNumber, column).font = { bold: true };
      sheet.getCell(rowNumber, column).fill = excelFill('EEF2F4');
    });
  });

  const summaryStart = 9;
  sheet.getRow(summaryStart).values = ['Date Range', 'Description', 'Qty / Miles', 'Rate', 'Total'];
  styleExcelHeaderRow(sheet.getRow(summaryStart));
  statementLaborRows.value.forEach((row) => {
    sheet.addRow([row.date, row.description, Number(row.days || 0), Number(row.rate || 0), Number(row.days || 0) * Number(row.rate || 0)]);
  });
  sheet.addRow(['', 'Expense category subtotal', '', '', expenseTotal.value]);
  sheet.addRow(['', `Mileage reimbursement (${number.format(totalMiles.value)} mi)`, totalMiles.value, mileageRateSummary(), mileageTotal.value]);
  sheet.addRow(['', 'Total reimbursable expenses', '', '', expenseTotal.value + mileageTotal.value]);
  const totalRow = sheet.addRow(['', '', '', 'TOTAL DUE', totalDue.value]);
  totalRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  totalRow.fill = excelFill('846268');
  styleExcelCurrencyColumn(sheet, 4, summaryStart + 1, totalRow.number);
  styleExcelCurrencyColumn(sheet, 5, summaryStart + 1, totalRow.number);
  styleExcelRange(sheet, summaryStart, totalRow.number, 1, 5, { border: true });

  const categoryStart = totalRow.number + 3;
  sheet.getRow(categoryStart).values = ['Category', ...categories, 'Expense Total', 'Mileage Total', 'Total Due'];
  styleExcelHeaderRow(sheet.getRow(categoryStart));
  const categoryRow = sheet.addRow(['Totals', ...categories.map((category) => expenseCategoryTotals.value[category] || 0), expenseTotal.value, mileageTotal.value, totalDue.value]);
  styleExcelCurrencyRow(categoryRow, 2, categoryRow.cellCount);
  styleExcelRange(sheet, categoryStart, categoryRow.number, 1, categoryRow.cellCount, { border: true });
}

function buildExpenseDetailSheet(workbook) {
  const sheet = workbook.addWorksheet('Expense Detail', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: '#', key: 'rowNumber', width: 8 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Vendor', key: 'vendor', width: 24 },
    { header: 'Description', key: 'description', width: 36 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Receipt Reference', key: 'receiptReference', width: 20 },
    { header: 'Amount', key: 'amount', width: 14 },
  ];
  compactExpenseRows.value.forEach((row) => sheet.addRow({ ...row, amount: Number(row.amount || 0) }));
  sheet.addRow({});
  const totalRow = sheet.addRow({ receiptReference: 'Total', amount: expenseTotal.value });
  totalRow.font = { bold: true };
  sheet.autoFilter = 'A1:G1';
  styleExcelTable(sheet, 1, Math.max(1, sheet.rowCount), 1, 7);
  styleExcelCurrencyColumn(sheet, 7, 2, sheet.rowCount);
}

function buildMileageDetailSheet(workbook) {
  const sheet = workbook.addWorksheet('Mileage Detail', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: '#', key: 'rowNumber', width: 8 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'From', key: 'from', width: 28 },
    { header: 'To', key: 'to', width: 28 },
    { header: 'Purpose', key: 'purpose', width: 30 },
    { header: 'Source', key: 'source', width: 14 },
    { header: 'Miles', key: 'miles', width: 12 },
    { header: 'Rate', key: 'rate', width: 12 },
    { header: 'Amount', key: 'amount', width: 14 },
  ];
  compactMileageRows.value.forEach((row) => sheet.addRow({ ...row, miles: Number(row.miles || 0), rate: Number(row.rate || 0), amount: Number(row.amount || 0) }));
  sheet.addRow({});
  const totalRow = sheet.addRow({ source: 'Totals', miles: totalMiles.value, amount: mileageTotal.value });
  totalRow.font = { bold: true };
  sheet.autoFilter = 'A1:I1';
  styleExcelTable(sheet, 1, Math.max(1, sheet.rowCount), 1, 9);
  styleExcelCurrencyColumn(sheet, 8, 2, sheet.rowCount);
  styleExcelCurrencyColumn(sheet, 9, 2, sheet.rowCount);
}

function buildWorkLogSummarySheet(workbook) {
  const sheet = workbook.addWorksheet('Work Log Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Work Type', key: 'label', width: 22 },
    { header: 'Date Range', key: 'dateRange', width: 24 },
    { header: 'Entries', key: 'entries', width: 12 },
    { header: 'Hours', key: 'hours', width: 12 },
    { header: 'Representative Summary', key: 'summary', width: 52 },
  ];
  (workLogSummaryRows.value.length ? workLogSummaryRows.value : [{ label: 'No work log rows', dateRange: '', entries: 0, hours: 0, summary: '' }]).forEach((row) => sheet.addRow(row));
  sheet.autoFilter = 'A1:E1';
  styleExcelTable(sheet, 1, Math.max(1, sheet.rowCount), 1, 5);
}

function excelFill(hex) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } };
}

function styleExcelHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = excelFill('4B5A60');
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
}

function styleExcelTable(sheet, firstRow, lastRow, firstColumn, lastColumn) {
  styleExcelHeaderRow(sheet.getRow(firstRow));
  styleExcelRange(sheet, firstRow, lastRow, firstColumn, lastColumn, { border: true });
  for (let rowNumber = firstRow + 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.alignment = { vertical: 'top', wrapText: true };
    if (rowNumber % 2 === 0) row.eachCell((cell) => { cell.fill = excelFill('FAFBFC'); });
  }
}

function styleExcelRange(sheet, firstRow, lastRow, firstColumn, lastColumn, options = {}) {
  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const cell = sheet.getCell(rowNumber, column);
      cell.alignment ||= { vertical: 'top', wrapText: true };
      if (options.border) {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD8E0E4' } },
          left: { style: 'thin', color: { argb: 'FFD8E0E4' } },
          bottom: { style: 'thin', color: { argb: 'FFD8E0E4' } },
          right: { style: 'thin', color: { argb: 'FFD8E0E4' } },
        };
      }
    }
  }
}

function styleExcelCurrencyColumn(sheet, column, firstRow, lastRow) {
  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber += 1) {
    sheet.getCell(rowNumber, column).numFmt = '$#,##0.00';
  }
}

function styleExcelCurrencyRow(row, firstColumn, lastColumn) {
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    row.getCell(column).numFmt = '$#,##0.00';
  }
}

function openPrintView() {
  state.tab = 'print';
  nextTick(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

async function printPackage() {
  state.tab = 'print';
  await nextTick();
  window.print();
}

function toggleCalculator() {
  state.calculator.open = !state.calculator.open;
}

function closeCalculator() {
  state.calculator.open = false;
}

function formatCalculatorNumber(value) {
  if (!Number.isFinite(value)) return 'Error';
  const rounded = Math.round((value + Number.EPSILON) * 100000000) / 100000000;
  return String(rounded).length > 12 ? rounded.toExponential(6) : String(rounded);
}

function calculatorInputDigit(digit) {
  const calculator = state.calculator;
  if (calculator.display === 'Error' || calculator.waitingForOperand) {
    calculator.display = String(digit);
    calculator.waitingForOperand = false;
    return;
  }
  calculator.display = calculator.display === '0' ? String(digit) : `${calculator.display}${digit}`;
}

function calculatorInputDecimal() {
  const calculator = state.calculator;
  if (calculator.display === 'Error' || calculator.waitingForOperand) {
    calculator.display = '0.';
    calculator.waitingForOperand = false;
    return;
  }
  if (!calculator.display.includes('.')) calculator.display = `${calculator.display}.`;
}

function calculatorClear() {
  Object.assign(state.calculator, {
    display: '0',
    storedValue: null,
    operator: '',
    waitingForOperand: false,
    history: '',
  });
}

function calculatorBackspace() {
  const calculator = state.calculator;
  if (calculator.display === 'Error' || calculator.waitingForOperand) {
    calculator.display = '0';
    calculator.waitingForOperand = false;
    return;
  }
  calculator.display = calculator.display.length > 1 ? calculator.display.slice(0, -1) : '0';
}

function calculatorToggleSign() {
  const calculator = state.calculator;
  if (calculator.display === '0' || calculator.display === 'Error') return;
  calculator.display = calculator.display.startsWith('-') ? calculator.display.slice(1) : `-${calculator.display}`;
}

function calculatorPercent() {
  const value = Number(state.calculator.display);
  state.calculator.display = formatCalculatorNumber(value / 100);
}

function runCalculatorOperation(left, right, operator) {
  if (operator === '+') return left + right;
  if (operator === '-') return left - right;
  if (operator === '*') return left * right;
  if (operator === '/') return right === 0 ? NaN : left / right;
  return right;
}

function calculatorChooseOperator(operator) {
  const calculator = state.calculator;
  const inputValue = Number(calculator.display);
  if (calculator.storedValue == null || calculator.operator === '') {
    calculator.storedValue = inputValue;
  } else if (!calculator.waitingForOperand) {
    const result = runCalculatorOperation(calculator.storedValue, inputValue, calculator.operator);
    calculator.display = formatCalculatorNumber(result);
    calculator.storedValue = result;
  }

  calculator.operator = operator;
  calculator.waitingForOperand = true;
  calculator.history = `${formatCalculatorNumber(calculator.storedValue)} ${operator}`;
}

function calculatorEquals() {
  const calculator = state.calculator;
  if (!calculator.operator || calculator.storedValue == null) return;
  const inputValue = Number(calculator.display);
  const result = runCalculatorOperation(calculator.storedValue, inputValue, calculator.operator);
  calculator.history = `${formatCalculatorNumber(calculator.storedValue)} ${calculator.operator} ${formatCalculatorNumber(inputValue)} =`;
  calculator.display = formatCalculatorNumber(result);
  calculator.storedValue = null;
  calculator.operator = '';
  calculator.waitingForOperand = true;
}

async function loadMemberPreferences() {
  state.preferences.loading = true;
  state.preferences.error = '';
  try {
    const payload = await apiJson('/api/me/preferences');
    state.preferences.mileageLocations = (payload.preferences?.mileageLocations || []).map(normalizeSavedMileageLocation);
  } catch (error) {
    state.preferences.error = error.message || 'Saved locations are unavailable.';
  } finally {
    state.preferences.loading = false;
  }
}

async function saveMemberPreferences() {
  state.preferences.saving = true;
  state.preferences.error = '';
  try {
    const payload = await apiJson('/api/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify({
        preferences: {
          mileageLocations: state.preferences.mileageLocations,
        },
      }),
    });
    state.preferences.mileageLocations = (payload.preferences?.mileageLocations || []).map(normalizeSavedMileageLocation);
    state.preferences.status = 'Saved locations updated.';
  } catch (error) {
    state.preferences.error = error.message || 'Could not save mileage locations.';
  } finally {
    state.preferences.saving = false;
  }
}

async function addSavedMileageLocation() {
  const draft = state.preferences.draftLocation;
  const address = draft.address.trim();
  if (!address) {
    state.preferences.error = 'Enter an address before saving a mileage location.';
    return;
  }
  state.preferences.saving = true;
  state.preferences.error = '';
  try {
    const place = await resolvePlaceFromText(address);
    if (!place) throw new Error('Address lookup did not find this location.');
    const location = normalizeSavedMileageLocation({
      id: newId(),
      label: draft.label.trim() || draft.type,
      type: draft.type,
      address: place.label || address,
      place,
    });
    state.preferences.mileageLocations = [
      location,
      ...state.preferences.mileageLocations.filter((item) => item.id !== location.id),
    ].slice(0, 24);
    state.preferences.draftLocation = blankSavedLocationDraft();
    await saveMemberPreferences();
  } catch (error) {
    state.preferences.error = error.message || 'Could not save mileage location.';
  } finally {
    state.preferences.saving = false;
  }
}

async function removeSavedMileageLocation(locationId) {
  state.preferences.mileageLocations = state.preferences.mileageLocations.filter((location) => location.id !== locationId);
  await saveMemberPreferences();
}

async function loadMembers() {
  if (!isAdmin.value) return;
  state.admin.loading = true;
  state.admin.error = '';
  try {
    const payload = await apiJson('/api/members');
    state.admin.members = payload.members || [];
  } catch (error) {
    state.admin.error = error.message;
  } finally {
    state.admin.loading = false;
  }
}

function resetMemberForm() {
  Object.assign(state.admin.form, { name: '', email: '', phone: '', role: 'member', pin: '' });
}

async function createMember() {
  state.admin.error = '';
  state.admin.status = '';
  try {
    const payload = await apiJson('/api/members', {
      method: 'POST',
      body: JSON.stringify(state.admin.form),
    });
    state.admin.members = [...state.admin.members, payload.member].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
    state.admin.status = `Created ${payload.member.name || 'member'} with account #${payload.member.accountNumber}.`;
    resetMemberForm();
  } catch (error) {
    state.admin.error = error.message;
  }
}

async function patchMember(member, patch) {
  state.admin.error = '';
  state.admin.status = '';
  try {
    const payload = await apiJson(`/api/members/${member.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    const index = state.admin.members.findIndex((item) => item.id === member.id);
    if (index >= 0) state.admin.members[index] = payload.member;
    state.admin.status = 'Member updated.';
  } catch (error) {
    state.admin.error = error.message;
  }
}

async function resetMemberPin(member) {
  const pin = window.prompt(`New PIN for ${member.name || member.accountNumber}`);
  if (!pin) return;
  await patchMember(member, { pin });
}

async function toggleMemberStatus(member) {
  await patchMember(member, { status: member.status === 'active' ? 'disabled' : 'active' });
}

async function assignProjectMember(project, memberId) {
  if (!isAdmin.value || !project) return;
  await patchProject(project, { memberId });
  if (state.currentProject?.id === project.id) applyAccountToProject(state.currentProject);
}

async function patchProject(project, patch) {
  if (state.storage === 'mongodb' && !isDeviceDraft(project)) {
    const payload = await apiJson(`/api/projects/${project.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    const updated = normalizeProject({ ...project, ...payload.project });
    const index = state.projects.findIndex((item) => item.id === project.id);
    if (index >= 0) state.projects[index] = updated;
    if (state.currentProject?.id === project.id) state.currentProject = { ...state.currentProject, ...updated };
    saveLocalArchive();
    return;
  }

  Object.assign(project, patch, { updatedAt: new Date().toISOString() });
  saveLocalArchive();
}

async function renameProject(project) {
  const title = window.prompt('Project name', project.title || projectTitle(project));
  if (!title) return;
  await patchProject(project, { title });
}

async function archiveProject(project) {
  await patchProject(project, { status: 'archived' });
}

async function restoreProject(project) {
  await patchProject(project, { status: 'active' });
}

async function deleteProject(project) {
  const title = projectTitle(project);
  if (!window.confirm(`Move "${title}" to Trash? You can restore it later.`)) return;
  await patchProject(project, { status: 'deleted' });
  if (state.currentProject?.id === project.id) {
    state.currentProject = state.projects.find((item) => item.status !== 'deleted') || null;
    if (state.currentProject && state.storage === 'mongodb') {
      await openProject(state.currentProject.id);
    }
  }

  if (!state.projects.some((item) => item.status !== 'deleted')) {
    await createProject('Untitled expense project');
  } else {
    saveLocalArchive();
  }
}

async function resetToBlankTemplate() {
  if (!state.currentProject) return;
  stopGpsTripWatcher();
  state.currentProject.data = blankProjectData();
  state.currentProject.title = 'Untitled expense project';
  state.currentProject = applyProjectDefaults(state.currentProject);
  state.gps.selectedMileageId = '';
  seedMileageForm();
  seedWorkLogForm();
  await saveCurrentProject();
}

function warnDuplicateExpense(row) {
  const duplicate = data.value.expenseRows.find(
    (item) =>
      item.date === row.date &&
      item.vendor?.trim().toLowerCase() === row.vendor?.trim().toLowerCase() &&
      Number(item.amount || 0) === Number(row.amount || 0)
  );
  state.duplicateWarning = duplicate ? 'Possible duplicate expense detected. Review the expense list before submitting again.' : '';
  return Boolean(duplicate);
}

function warnDuplicateMileage(row) {
  const duplicate = data.value.mileageRows.find(
    (item) =>
      item.date === row.date &&
      item.from?.trim().toLowerCase() === row.from?.trim().toLowerCase() &&
      item.to?.trim().toLowerCase() === row.to?.trim().toLowerCase() &&
      Math.abs(Number(item.miles || 0) - Number(row.miles || 0)) < 0.01
  );
  state.duplicateWarning = duplicate ? 'Possible duplicate mileage row detected. Review the mileage list before submitting again.' : '';
  return Boolean(duplicate);
}

async function addExpense() {
  const row = {
    id: state.editing.expenseId || newId(),
    date: expenseForm.date,
    vendor: expenseForm.vendor.trim(),
    description: expenseForm.description.trim(),
    category: expenseForm.category,
    amount: Number(expenseForm.amount || 0),
  };
  clearCrudUndo();
  if (!state.editing.expenseId && warnDuplicateExpense(row) && !window.confirm('This looks like a duplicate expense. Add it anyway?')) return;
  if (state.editing.expenseId) {
    const index = data.value.expenseRows.findIndex((item) => item.id === state.editing.expenseId);
    if (index >= 0) data.value.expenseRows[index] = { ...data.value.expenseRows[index], ...row };
    state.editing.expenseId = '';
  } else {
    data.value.expenseRows.push(row);
  }
  state.duplicateWarning = '';
  updateEntryDefaultsFromExpense(row);
  Object.assign(expenseForm, { date: row.date || currentDateInputValue(), vendor: '', description: '', category: row.category || 'Hotel', amount: '' });
  await saveCurrentProject();
}

function editExpense(row) {
  clearCrudUndo();
  state.editing.expenseId = row.id;
  Object.assign(expenseForm, {
    date: row.date || currentDateInputValue(),
    vendor: row.vendor || '',
    description: row.description || '',
    category: row.category || 'Hotel',
    amount: row.amount || '',
  });
  nextTick(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

async function addMileage() {
  const row = mileageRowFromForm();
  clearCrudUndo();
  if (!state.editing.mileageId && warnDuplicateMileage(row) && !window.confirm('This looks like duplicate mileage. Add it anyway?')) return;
  if (state.editing.mileageId) {
    const index = data.value.mileageRows.findIndex((item) => item.id === state.editing.mileageId);
    if (index >= 0) data.value.mileageRows[index] = { ...data.value.mileageRows[index], ...row, id: state.editing.mileageId };
    state.editing.mileageId = '';
  } else {
    data.value.mileageRows.push(row);
  }
  state.duplicateWarning = '';
  updateEntryDefaultsFromMileage(row);
  resetMileageForm();
  await saveCurrentProject();
}

function mileageRowFromForm(overrides = {}) {
  const isAddressRoute = mileageForm.calculationMode === 'address-route' && mileageForm.routeGeometry.length;
  const existing = state.editing.mileageId ? data.value.mileageRows.find((row) => row.id === state.editing.mileageId) : null;
  const preserveGps = existing?.trackingMode === 'gps' && !isAddressRoute;
  return {
    id: newId(),
    trackingMode: preserveGps ? 'gps' : 'manual',
    calculationMode: isAddressRoute ? 'address-route' : preserveGps ? 'gps' : 'manual',
    date: mileageForm.date,
    from: mileageForm.from.trim(),
    to: mileageForm.to.trim(),
    purpose: mileageForm.purpose.trim(),
    miles: Number(mileageForm.miles || 0),
    rate: Number(mileageForm.rate || 0),
    routePoints: preserveGps ? existing.routePoints || [] : [],
    routeGeometry: isAddressRoute ? [...mileageForm.routeGeometry] : [],
    routeDistanceMiles: isAddressRoute ? Number(mileageForm.routeDistanceMiles || mileageForm.miles || 0) : 0,
    fromPlace: isAddressRoute ? mileageForm.fromPlace : null,
    toPlace: isAddressRoute ? mileageForm.toPlace : null,
    distanceMiles: Number(mileageForm.miles || 0),
    durationSeconds: isAddressRoute ? Number(mileageForm.routeDurationSeconds || 0) : Number(existing?.durationSeconds || 0),
    pausedSeconds: Number(existing?.pausedSeconds || 0),
    pauseSegments: existing?.pauseSegments || [],
    startLocation: existing?.startLocation || '',
    endLocation: existing?.endLocation || '',
    ...overrides,
  };
}

function editMileage(row) {
  clearCrudUndo();
  state.editing.mileageId = row.id;
  Object.assign(mileageForm, {
    date: row.date || currentDateInputValue(),
    from: row.from || '',
    to: row.to || '',
    purpose: row.purpose || '',
    miles: row.miles || '',
    rate: row.rate || state.entryDefaults.mileageRate || '0.725',
    fromSavedLocationId: '',
    toSavedLocationId: '',
    fromPlace: row.fromPlace || null,
    toPlace: row.toPlace || null,
    routeGeometry: row.routeGeometry || [],
    routeDistanceMiles: row.routeDistanceMiles || row.distanceMiles || row.miles || 0,
    routeDurationSeconds: row.routeDurationSeconds || row.durationSeconds || 0,
    calculationMode: row.calculationMode || 'manual',
  });
  if (rowRoutePoints(row).length) state.gps.selectedMileageId = row.id;
  nextTick(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

function resetMileageForm() {
  seedMileageForm();
  state.editing.mileageId = '';
  state.places.fromSuggestions = [];
  state.places.toSuggestions = [];
}

function clearAddressRoute() {
  mileageForm.routeGeometry = [];
  mileageForm.routeDistanceMiles = 0;
  mileageForm.routeDurationSeconds = 0;
  mileageForm.calculationMode = 'manual';
  if (state.gps.selectedMileageId === 'draft-route') {
    state.gps.selectedMileageId = '';
  }
}

function handleLaborDateChange(kind) {
  const count = weekdayCountInRange(report.value[`${kind}From`], report.value[`${kind}To`]);
  if (count) report.value[`${kind}Days`] = count;
  scheduleAutoSave();
}

function handleAddressInput(field) {
  const placeKey = `${field}Place`;
  const suggestionsKey = `${field}Suggestions`;
  mileageForm[placeKey] = null;
  clearAddressRoute();
  state.places.error = '';

  const text = mileageForm[field].trim();
  clearTimeout(addressTimers[field]);
  if (text.length < 3) {
    state.places[suggestionsKey] = [];
    return;
  }

  addressTimers[field] = setTimeout(() => fetchAddressSuggestions(field, text), 350);
}

async function resolvePlaceFromText(text) {
  if (!text || text.trim().length < 3) return null;
  const payload = await apiJson(`/api/places/autocomplete?text=${encodeURIComponent(text.trim())}`);
  return normalizePlace(payload.suggestions?.[0]);
}

async function fetchAddressSuggestions(field, text) {
  const suggestionsKey = `${field}Suggestions`;
  try {
    state.places.loadingField = field;
    const payload = await apiJson(`/api/places/autocomplete?text=${encodeURIComponent(text)}`);
    if (mileageForm[field].trim() !== text) return;
    state.places[suggestionsKey] = payload.suggestions || [];
  } catch (error) {
    state.places[suggestionsKey] = [];
    state.places.error = error.message || 'Address suggestions are unavailable.';
  } finally {
    if (state.places.loadingField === field) {
      state.places.loadingField = '';
    }
  }
}

async function selectAddressSuggestion(field, suggestion) {
  const place = normalizePlace(suggestion);
  if (!place) return;
  const placeKey = `${field}Place`;
  const suggestionsKey = `${field}Suggestions`;
  mileageForm[field] = place.label;
  mileageForm[placeKey] = place;
  state.places[suggestionsKey] = [];
  state.places.error = '';

  if (mileageForm.fromPlace && mileageForm.toPlace) {
    await calculateAddressMileage();
  }
}

async function calculateAddressMileage() {
  if (!mileageForm.fromPlace || !mileageForm.toPlace) return;
  try {
    state.places.routeLoading = true;
    const route = await fetchRouteBetweenPlaces(mileageForm.fromPlace, mileageForm.toPlace);
    mileageForm.miles = route.distanceMiles || '';
    mileageForm.routeDistanceMiles = route.distanceMiles || 0;
    mileageForm.routeDurationSeconds = route.durationSeconds || 0;
    mileageForm.routeGeometry = Array.isArray(route.routeGeometry) ? route.routeGeometry.map(normalizeRoutePoint) : [];
    mileageForm.calculationMode = mileageForm.routeGeometry.length ? 'address-route' : 'manual';
    state.gps.selectedMileageId = mileageForm.routeGeometry.length ? 'draft-route' : '';
    state.places.error = '';
  } catch (error) {
    clearAddressRoute();
    state.places.error = error.message || 'Mileage calculation is unavailable.';
  } finally {
    state.places.routeLoading = false;
  }
}

async function fetchRouteBetweenPlaces(fromPlace, toPlace) {
  const params = new URLSearchParams({
    fromLat: fromPlace.lat,
    fromLng: fromPlace.lng,
    toLat: toPlace.lat,
    toLng: toPlace.lng,
  });
  const payload = await apiJson(`/api/places/route?${params.toString()}`);
  return payload.route || {};
}

async function applySavedLocationToMileage(field, locationId) {
  const location = savedLocationById(locationId);
  const place = savedLocationPlace(location);
  const placeKey = `${field}Place`;
  if (!location || !place) {
    mileageForm[`${field}SavedLocationId`] = '';
    return;
  }
  mileageForm[field] = location.address || place.label;
  mileageForm[placeKey] = place;
  clearAddressRoute();
  state.places.error = '';
  if (mileageForm.fromPlace && mileageForm.toPlace) {
    await calculateAddressMileage();
  }
}

async function applyLocationRoute(fromLocation, toLocation, purpose) {
  const fromPlace = savedLocationPlace(fromLocation);
  const toPlace = savedLocationPlace(toLocation);
  if (!fromLocation || !toLocation || !fromPlace || !toPlace) {
    state.places.error = 'Save the needed mileage locations before using this quick route.';
    return;
  }
  Object.assign(mileageForm, {
    date: mileageForm.date || data.value.workLogs[data.value.workLogs.length - 1]?.date || currentDateInputValue(),
    from: fromLocation.address || fromPlace.label,
    to: toLocation.address || toPlace.label,
    purpose,
    rate: state.entryDefaults.mileageRate || mileageForm.rate || '0.725',
    fromSavedLocationId: fromLocation.id,
    toSavedLocationId: toLocation.id,
    fromPlace,
    toPlace,
  });
  clearAddressRoute();
  await calculateAddressMileage();
}

async function applyQuickMileageRoute(direction) {
  const home = savedLocationByType('home', 'office');
  const savedSite = savedLocationByType('site');
  const hotel = savedLocationByType('hotel');
  if (direction === 'home-to-site') return applyLocationRoute(home, savedSite, 'Travel to site');
  if (direction === 'site-to-home') return applyLocationRoute(savedSite, home, 'Return from site');
  if (direction === 'hotel-to-site') return applyLocationRoute(hotel, savedSite, 'Travel to site');
  if (direction === 'site-to-hotel') return applyLocationRoute(savedSite, hotel, 'Return to hotel');

  const start = state.entryDefaults.startAddress || report.value.address || '';
  const site = meta.value.siteAddress || meta.value.siteName || state.entryDefaults.siteAddress || state.entryDefaults.siteName || '';
  const fromText = direction === 'site-to-start' ? site : start;
  const toText = direction === 'site-to-start' ? start : site;

  Object.assign(mileageForm, {
    date: mileageForm.date || data.value.workLogs[data.value.workLogs.length - 1]?.date || currentDateInputValue(),
    from: fromText,
    to: toText,
    purpose: direction === 'site-to-start' ? 'Return from site' : 'Travel to site',
    rate: state.entryDefaults.mileageRate || mileageForm.rate || '0.725',
    fromSavedLocationId: '',
    toSavedLocationId: '',
    fromPlace: null,
    toPlace: null,
  });
  clearAddressRoute();

  if (!fromText || !toText) {
    state.places.error = 'Add a home/start address and site address to use quick routes.';
    return;
  }

  try {
    state.places.routeLoading = true;
    mileageForm.fromPlace = await resolvePlaceFromText(fromText);
    mileageForm.toPlace = await resolvePlaceFromText(toText);
    if (!mileageForm.fromPlace || !mileageForm.toPlace) throw new Error('Address lookup did not find both route endpoints.');
    await calculateAddressMileage();
  } catch (error) {
    state.places.error = `${error.message || 'Quick route lookup failed.'} You can still enter miles manually.`;
  } finally {
    state.places.routeLoading = false;
  }
}

async function addRoundTripMileage() {
  if (!mileageForm.from.trim() || !mileageForm.to.trim()) {
    state.places.error = 'Choose From and To before creating a round trip.';
    return;
  }
  if (!mileageForm.routeGeometry.length && mileageForm.fromPlace && mileageForm.toPlace) {
    await calculateAddressMileage();
  }
  const outbound = mileageRowFromForm({
    purpose: mileageForm.purpose.trim() || 'Outbound trip',
    returnPurpose: 'Return trip',
  });
  const rows = createRoundTripRows(outbound, newId);
  rows.forEach((row) => {
    if (row.calculationMode === 'address-route' && !row.routeGeometry.length && outbound.routeGeometry.length) {
      row.routeGeometry = row.from === outbound.from ? [...outbound.routeGeometry] : reverseRouteGeometry(outbound.routeGeometry);
    }
  });
  clearCrudUndo();
  data.value.mileageRows.push(...rows);
  state.duplicateWarning = '';
  updateEntryDefaultsFromMileage(rows[0]);
  resetMileageForm();
  await saveCurrentProject();
}

function preferredMileageStartLocation() {
  return savedLocationByType('hotel') || savedLocationByType('home', 'office');
}

async function generateWorkLogMileageDrafts() {
  const fromLocation = preferredMileageStartLocation();
  const toLocation = savedLocationByType('site');
  const fromPlace = savedLocationPlace(fromLocation);
  const toPlace = savedLocationPlace(toLocation);
  if (!fromLocation || !toLocation || !fromPlace || !toPlace) {
    state.places.error = 'Save a Home/Office or Hotel location and a Site location before generating work-log mileage.';
    return;
  }

  const missingDates = workLogDatesMissingMileage(data.value.workLogs, data.value.mileageRows);
  if (!missingDates.length) {
    state.places.error = 'No work-log dates are missing mileage.';
    state.mileageDrafts = [];
    return;
  }

  try {
    state.places.routeLoading = true;
    const route = await fetchRouteBetweenPlaces(fromPlace, toPlace);
    const routeGeometry = Array.isArray(route.routeGeometry) ? route.routeGeometry.map(normalizeRoutePoint) : [];
    state.mileageDrafts = missingDates.map((date) => ({
      id: newId(),
      selected: true,
      trackingMode: 'manual',
      calculationMode: routeGeometry.length ? 'address-route' : 'manual',
      date,
      from: fromLocation.address || fromPlace.label,
      to: toLocation.address || toPlace.label,
      purpose: 'Travel to site',
      miles: Number(route.distanceMiles || 0),
      rate: Number(state.entryDefaults.mileageRate || mileageForm.rate || 0.725),
      routePoints: [],
      routeGeometry: [...routeGeometry],
      routeDistanceMiles: Number(route.distanceMiles || 0),
      fromPlace,
      toPlace,
      distanceMiles: Number(route.distanceMiles || 0),
      durationSeconds: Number(route.durationSeconds || 0),
      startLocation: '',
      endLocation: '',
    }));
    state.places.error = '';
  } catch (error) {
    state.places.error = error.message || 'Could not generate mileage drafts.';
  } finally {
    state.places.routeLoading = false;
  }
}

async function saveSelectedMileageDrafts() {
  const rows = selectedMileageDrafts.value.map(({ selected, ...row }) => ({
    ...row,
    id: newId(),
    routeGeometry: Array.isArray(row.routeGeometry) ? row.routeGeometry.map(normalizeRoutePoint) : [],
  }));
  if (!rows.length) {
    state.places.error = 'Select at least one mileage draft to save.';
    return;
  }
  clearCrudUndo();
  data.value.mileageRows.push(...rows);
  updateEntryDefaultsFromMileage(rows[rows.length - 1]);
  state.mileageDrafts = [];
  state.places.error = '';
  await saveCurrentProject();
}

function repeatLastMileageRoute() {
  const route = state.entryDefaults.lastMileageRoute;
  if (!route) {
    state.places.error = 'No prior route has been saved on this device yet.';
    return;
  }

  Object.assign(mileageForm, {
    date: data.value.workLogs[data.value.workLogs.length - 1]?.date || currentDateInputValue(),
    from: route.from || '',
    to: route.to || '',
    purpose: route.purpose || 'Repeat route',
    miles: route.routeDistanceMiles || '',
    rate: state.entryDefaults.mileageRate || mileageForm.rate || '0.725',
    fromSavedLocationId: '',
    toSavedLocationId: '',
    fromPlace: route.fromPlace || null,
    toPlace: route.toPlace || null,
    routeGeometry: Array.isArray(route.routeGeometry) ? route.routeGeometry.map(normalizeRoutePoint) : [],
    routeDistanceMiles: route.routeDistanceMiles || 0,
    routeDurationSeconds: route.routeDurationSeconds || 0,
    calculationMode: route.calculationMode || (route.routeGeometry?.length ? 'address-route' : 'manual'),
  });
  state.gps.selectedMileageId = mileageForm.routeGeometry.length ? 'draft-route' : '';
  state.places.error = '';
}

function goToEntry(tab, mode = '') {
  state.tab = tab;
  if (tab === 'expenses' && mode === 'receipt') nextTick(() => receiptFileInput.value?.click());
  if (tab === 'mileage' && !mileageForm.date) seedMileageForm();
  if (tab === 'worklog' && !workLogForm.date) seedWorkLogForm();
}

function currentDateInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function pointLabel(point) {
  if (!point) return '';
  return `${Number(point.lat).toFixed(5)}, ${Number(point.lng).toFixed(5)}`;
}

function metersToMiles(meters) {
  return Number((meters / metersPerMile).toFixed(2));
}

function haversineMeters(a, b) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const radius = 6371000;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const value =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function totalRouteMeters(points) {
  return points.reduce((total, point, index) => {
    if (index === 0) return total;
    return total + haversineMeters(points[index - 1], point);
  }, 0);
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = Math.floor(total % 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function startGpsTimer() {
  clearInterval(gpsTimer);
  gpsTimer = setInterval(() => {
    if (state.gps.active && state.gps.startedAt) {
      state.gps.elapsedSeconds = currentGpsElapsedSeconds();
    }
  }, 1000);
}

function currentGpsElapsedSeconds(now = Date.now()) {
  if (!state.gps.startedAt) return 0;
  const activePauseSeconds = state.gps.paused && state.gps.pausedAt ? Math.floor((now - state.gps.pausedAt) / 1000) : 0;
  return Math.max(0, Math.floor((now - state.gps.startedAt) / 1000) - state.gps.pausedSeconds - activePauseSeconds);
}

function finalizeGpsPause(now = Date.now()) {
  if (!state.gps.paused || !state.gps.pausedAt) return;
  const durationSeconds = Math.max(0, Math.floor((now - state.gps.pausedAt) / 1000));
  state.gps.pauseSegments.push({
    startedAt: new Date(state.gps.pausedAt).toISOString(),
    endedAt: new Date(now).toISOString(),
    durationSeconds,
  });
  state.gps.pausedSeconds += durationSeconds;
  state.gps.paused = false;
  state.gps.pausedAt = null;
}

function stopGpsTripWatcher() {
  if (state.gps.watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.gps.watchId);
  }
  clearInterval(gpsTimer);
  gpsTimer = null;
  state.gps.watchId = null;
  state.gps.active = false;
  state.gps.paused = false;
  state.gps.pausedAt = null;
}

function startGpsTrip() {
  if (!navigator.geolocation) {
    state.gps.error = 'GPS is not available in this browser.';
    return;
  }

  stopGpsTripWatcher();
  state.gps.routePoints = [];
  state.gps.lastAccuracy = null;
  state.gps.error = 'Waiting for GPS signal...';
  state.gps.startedAt = Date.now();
  state.gps.elapsedSeconds = 0;
  state.gps.paused = false;
  state.gps.pausedAt = null;
  state.gps.pausedSeconds = 0;
  state.gps.pauseSegments = [];
  state.gps.active = true;
  startGpsTimer();

  state.gps.watchId = navigator.geolocation.watchPosition(recordGpsPosition, handleGpsError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000,
  });
}

function recordGpsPosition(position) {
  if (state.gps.paused) return;
  const { latitude, longitude, accuracy } = position.coords || {};
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    state.gps.error = 'GPS returned an empty location. Keep the app open and try again.';
    return;
  }

  const point = {
    lat: Number(latitude.toFixed(6)),
    lng: Number(longitude.toFixed(6)),
    accuracy: Math.round(Number(accuracy || 0)),
    timestamp: new Date(position.timestamp || Date.now()).toISOString(),
  };
  const lastPoint = state.gps.routePoints[state.gps.routePoints.length - 1];
  const movedMeters = lastPoint ? haversineMeters(lastPoint, point) : Infinity;
  const elapsedSinceLast = lastPoint ? new Date(point.timestamp).getTime() - new Date(lastPoint.timestamp).getTime() : Infinity;

  state.gps.lastAccuracy = point.accuracy;
  state.gps.error =
    point.accuracy > gpsAccuracyLimit
      ? `GPS accuracy is weak (${point.accuracy}m). Tracking continues, but mileage may need review.`
      : '';

  if (!lastPoint || movedMeters >= 3 || elapsedSinceLast >= 10000) {
    state.gps.routePoints.push(point);
  }
}

function pauseGpsTrip() {
  if (!state.gps.active || state.gps.paused) return;
  state.gps.paused = true;
  state.gps.pausedAt = Date.now();
  state.gps.elapsedSeconds = currentGpsElapsedSeconds();
  state.gps.error = 'GPS trip paused.';
}

function resumeGpsTrip() {
  if (!state.gps.active || !state.gps.paused) return;
  finalizeGpsPause();
  state.gps.elapsedSeconds = currentGpsElapsedSeconds();
  state.gps.error = '';
}

function handleGpsError(error) {
  const messages = {
    1: 'Location permission was denied. Manual mileage entry is still available.',
    2: 'Location is unavailable right now. Move near a window or try again.',
    3: 'GPS timed out before a location was captured. Try again with the app open.',
  };
  state.gps.error = messages[error.code] || error.message || 'GPS tracking failed.';
  if (!state.gps.routePoints.length) {
    stopGpsTripWatcher();
  }
}

async function stopGpsTrip() {
  finalizeGpsPause();
  const durationSeconds = currentGpsElapsedSeconds();
  stopGpsTripWatcher();
  const points = state.gps.routePoints.map(normalizeRoutePoint);
  const distanceMiles = liveGpsMiles.value;

  if (points.length < 2 || distanceMiles < 0.01) {
    state.gps.error = 'Trip was not saved because there were not enough GPS points to calculate mileage.';
    return;
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const startedAt = new Date(state.gps.startedAt || Date.now());
  const row = {
    id: newId(),
    trackingMode: 'gps',
    date: currentDateInputValue(startedAt),
    from: pointLabel(firstPoint),
    to: pointLabel(lastPoint),
    purpose: 'GPS trip',
    miles: distanceMiles,
    rate: Number(mileageForm.rate || 0.725),
    routePoints: points,
    distanceMiles,
    durationSeconds,
    pausedSeconds: state.gps.pausedSeconds,
    pauseSegments: [...state.gps.pauseSegments],
    startLocation: pointLabel(firstPoint),
    endLocation: pointLabel(lastPoint),
  };

  clearCrudUndo();
  data.value.mileageRows.push(row);
  state.gps.selectedMileageId = row.id;
  state.gps.routePoints = [];
  state.gps.error = '';
  state.gps.pausedSeconds = 0;
  state.gps.pauseSegments = [];
  updateEntryDefaultsFromMileage(row);
  await saveCurrentProject();
}

function discardGpsTrip() {
  stopGpsTripWatcher();
  state.gps.routePoints = [];
  state.gps.startedAt = null;
  state.gps.elapsedSeconds = 0;
  state.gps.paused = false;
  state.gps.pausedAt = null;
  state.gps.pausedSeconds = 0;
  state.gps.pauseSegments = [];
  state.gps.lastAccuracy = null;
  state.gps.error = '';
}

function selectMileageRoute(row) {
  if (rowRoutePoints(row).length) {
    state.gps.selectedMileageId = row.id;
  }
}

function handleWorkLogDateChange() {
  workLogForm.taskCategory = inferWorkCategoryForDate(workLogForm.date);
  handleWorkLogTypeChange();
}

function handleWorkLogTypeChange() {
  workLogForm.location = workLogLocationForType(workLogForm.taskCategory, meta.value, state.entryDefaults);
}

function handleWorkLogHourPresetChange() {
  if (workLogForm.hourPreset !== 'Custom') workLogForm.hours = workLogForm.hourPreset;
}

function skipWorkLogDay() {
  const nextDate = nextWeekdayInPeriod(workLogForm.date);
  workLogForm.date = nextDate;
  handleWorkLogDateChange();
}

function buildWorkLogRow() {
  const row = {
    id: state.editing.workLogId || newId(),
    date: workLogForm.date,
    clientSite: workLogForm.clientSite.trim(),
    location: workLogForm.location.trim(),
    taskCategory: workLogForm.taskCategory.trim(),
    hours: Number(workLogForm.hours || 0),
    summary: workLogForm.summary.trim() || generatedWorkLogSummary.value,
    actions: workLogForm.showDetails ? workLogForm.actions.trim() : '',
    status: workLogForm.status.trim(),
  };
  return row;
}

async function addWorkLog(options = {}) {
  const row = buildWorkLogRow();
  const duplicateDate = data.value.workLogs.some((item) => item.date === row.date && item.id !== state.editing.workLogId);
  if (duplicateDate && !options.allowDuplicate && !options.replaceExisting) {
    state.error = 'This date already has a work log. Add another entry or replace the existing one.';
    return;
  }
  clearCrudUndo();
  if (state.editing.workLogId) {
    const index = data.value.workLogs.findIndex((item) => item.id === state.editing.workLogId);
    if (index >= 0) data.value.workLogs[index] = row;
    state.editing.workLogId = '';
  } else if (options.replaceExisting) {
    const result = replaceRowsWithUndo(data.value, 'workLogs', (item) => item.date === row.date, [row], 'Work log replaced.');
    state.currentProject.data = normalizeProjectData(result.data);
    setCrudUndo(result.undo, 'Work log replaced.');
  } else {
    data.value.workLogs.push(row);
  }
  state.error = '';
  updateEntryDefaultsFromWorkLog(row);
  seedWorkLogForm(row.date);
  await saveCurrentProject();
}

function editWorkLog(row) {
  clearCrudUndo();
  state.editing.workLogId = row.id;
  Object.assign(workLogForm, {
    date: row.date || currentDateInputValue(),
    clientSite: row.clientSite || '',
    location: row.location || '',
    taskCategory: row.taskCategory || inferWorkCategoryForDate(row.date),
    hours: String(row.hours || 8),
    hourPreset: workLogHourOptions.includes(String(row.hours || '')) ? String(row.hours) : 'Custom',
    summary: row.summary || '',
    actions: row.actions || '',
    status: row.status || 'Draft',
    showDetails: Boolean(row.actions || row.summary),
  });
  nextTick(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

async function addSameAsPreviousWorkLog() {
  const previous = data.value.workLogs[data.value.workLogs.length - 1];
  if (!previous) {
    await addWorkLog();
    return;
  }
  const nextDate = nextWeekdayInPeriod(previous.date);
  Object.assign(workLogForm, {
    date: nextDate,
    clientSite: previous.clientSite || workLogForm.clientSite,
    location: previous.location || workLogForm.location,
    taskCategory: previous.taskCategory || inferWorkCategoryForDate(nextDate),
    hours: String(previous.hours || workLogForm.hours || 8),
    hourPreset: workLogHourOptions.includes(String(previous.hours || '')) ? String(previous.hours) : 'Custom',
    summary: '',
    actions: previous.actions || '',
    status: previous.status || workLogForm.status || 'Draft',
  });
  await addWorkLog();
}

async function generateWorkLogDrafts() {
  const existingDates = new Set(data.value.workLogs.map((row) => row.date));
  const draftRows = [];
  const groups = [
    {
      from: report.value.onsiteFrom,
      to: report.value.onsiteTo,
      taskCategory: 'Onsite work',
      summary: report.value.onsiteDescription || 'Onsite work',
    },
    {
      from: report.value.remoteFrom,
      to: report.value.remoteTo,
      taskCategory: 'Remote work',
      summary: report.value.remoteDescription || 'Remote work',
    },
  ];

  groups.forEach((group) => {
    datesForWeekdayRange(group.from, group.to).forEach((date) => {
      if (existingDates.has(date)) return;
      existingDates.add(date);
      draftRows.push({
        id: newId(),
        date,
        clientSite: meta.value.clientName || meta.value.siteName || state.entryDefaults.clientName,
        location: workLogLocationForType(group.taskCategory, meta.value, state.entryDefaults),
        taskCategory: group.taskCategory,
        hours: 8,
        summary: autoWorkLogSummary({
          workType: group.taskCategory,
          clientSite: meta.value.clientName || meta.value.siteName || state.entryDefaults.clientName,
          location: workLogLocationForType(group.taskCategory, meta.value, state.entryDefaults),
          notes: group.summary,
        }),
        actions: '',
        status: 'Needs review',
      });
    });
  });

  if (!draftRows.length) {
    state.error = 'No new weekday work log drafts were available from the onsite/remote date ranges.';
    return;
  }

  clearCrudUndo();
  data.value.workLogs.push(...draftRows);
  draftRows.forEach(updateEntryDefaultsFromWorkLog);
  seedWorkLogForm(draftRows[draftRows.length - 1].date);
  await saveCurrentProject();
  state.saveNotice = `${draftRows.length} work log draft${draftRows.length === 1 ? '' : 's'} generated.`;
}

async function removeRow(collection, id) {
  const labels = {
    expenseRows: 'Expense and linked receipt deleted.',
    mileageRows: 'Mileage row deleted.',
    workLogs: 'Work log deleted.',
  };
  const result = deleteRowWithUndo(data.value, collection, id, {
    label: labels[collection] || 'Row deleted.',
    selectedMileageId: collection === 'mileageRows' ? state.gps.selectedMileageId : '',
  });
  state.currentProject.data = normalizeProjectData(result.data);
  refreshReceiptQueue();
  setCrudUndo(result.undo, labels[collection]);
  if (collection === 'mileageRows' && state.gps.selectedMileageId === id) state.gps.selectedMileageId = '';
  if (collection === 'workLogs' && state.editing.workLogId === id) cancelWorkLogEdit();
  if (collection === 'expenseRows' && state.editing.expenseId === id) cancelExpenseEdit();
  if (collection === 'mileageRows' && state.editing.mileageId === id) cancelMileageEdit();
  await saveCurrentProject();
}

async function removeReceipt(receipt) {
  const linkedExpense = data.value.expenseRows.find((row) => row.id === receipt.expenseId || row.receiptId === receipt.id);
  const deleteLinkedExpense = linkedExpense ? window.confirm('Delete this receipt and its linked expense row? Choose Cancel to delete only the receipt.') : false;
  const result = deleteRowWithUndo(data.value, 'receipts', receipt.id, {
    deleteLinkedExpense,
    label: deleteLinkedExpense ? 'Receipt and linked expense deleted.' : 'Receipt deleted.',
  });
  state.currentProject.data = normalizeProjectData(result.data);
  refreshReceiptQueue();
  setCrudUndo(result.undo, deleteLinkedExpense ? 'Receipt and linked expense deleted.' : 'Receipt deleted.');
  await saveCurrentProject();
}

function hasMileageForDate(date) {
  return data.value.mileageRows.some((row) => row.date === date);
}

function formatPeriod() {
  return `${report.value.periodFrom || ''} - ${report.value.periodTo || ''}`;
}

function formatPostalAddressLines(value) {
  const raw = String(value || '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return [];

  const zipMatch = raw.match(/\b\d{5}(?:-\d{4})?\b$/);
  const zip = zipMatch?.[0] || '';
  const withoutZip = zip ? raw.slice(0, zipMatch.index).replace(/[,\s]+$/, '') : raw;
  const parts = withoutZip.split(',').map((part) => part.trim()).filter(Boolean);
  let street = '';
  let city = '';
  let state = '';

  if (parts.length >= 3) {
    street = parts.slice(0, -2).join(', ');
    city = parts.at(-2);
    state = normalizeState(parts.at(-1));
  } else if (parts.length === 2) {
    street = parts[0];
    const parsed = splitCityState(parts[1]);
    city = parsed.city;
    state = parsed.state;
  } else {
    const parsed = splitUnpunctuatedAddress(withoutZip);
    street = parsed.street;
    city = parsed.city;
    state = parsed.state;
  }

  const cityState = [city, state].filter(Boolean).join(', ');
  return [street || withoutZip, cityState, zip].filter(Boolean);
}

function splitCityState(value) {
  const state = extractTrailingState(value);
  if (!state) return { city: value.trim(), state: '' };
  return {
    city: value.slice(0, state.index).replace(/[,\s]+$/, ''),
    state: state.abbreviation,
  };
}

function splitUnpunctuatedAddress(value) {
  const state = extractTrailingState(value);
  if (!state) return { street: value, city: '', state: '' };

  const beforeState = value.slice(0, state.index).trim();
  const words = beforeState.split(/\s+/).filter(Boolean);
  let cityWordCount = Math.min(2, words.length);
  if (words.length >= 3 && words.at(-2)?.toLowerCase() === 'of') cityWordCount = 3;
  const cityWords = words.slice(-cityWordCount);
  const streetWords = words.slice(0, -cityWordCount);
  return {
    street: streetWords.join(' ') || beforeState,
    city: streetWords.length ? cityWords.join(' ') : '',
    state: state.abbreviation,
  };
}

function extractTrailingState(value) {
  const source = value.trim();
  const abbreviations = Object.values(usStateAbbreviations);
  const stateNames = Object.keys(usStateAbbreviations).sort((a, b) => b.length - a.length);

  for (const abbreviation of abbreviations) {
    const match = source.match(new RegExp(`\\b${abbreviation}\\.?$`, 'i'));
    if (match) return { abbreviation, index: match.index };
  }

  for (const name of stateNames) {
    const match = source.match(new RegExp(`\\b${name}$`, 'i'));
    if (match) return { abbreviation: usStateAbbreviations[name], index: match.index };
  }

  return null;
}

function normalizeState(value = '') {
  const clean = value.toLowerCase().replace(/\./g, '').trim();
  return usStateAbbreviations[clean] || value.trim().toUpperCase();
}

function formatDateRange(from, to) {
  if (from && to) return `${from} - ${to}`;
  return from || to || '';
}

function reportPrintDate() {
  return report.value.reportDate || new Date().toISOString().slice(0, 10);
}

async function handleReceiptFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  revokeReceiptPreview();
  state.receiptDraft = emptyReceiptDraft();
  state.receiptDraft.fileName = compressedReceiptFileName(file.name);
  state.receiptDraft.originalSize = file.size;
  state.receiptOcrRunning = true;

  try {
    const image = await compressImage(file);
    state.receiptDraft.imageBlob = image.blob;
    state.receiptDraft.previewUrl = image.previewUrl;
    state.receiptDraft.compressedSize = image.blob.size;

    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    const result = await worker.recognize(image.blob);
    await worker.terminate();

    const parsed = parseReceiptText(result.data.text || '');
    state.receiptDraft = {
      ...state.receiptDraft,
      ...parsed,
      ocrText: result.data.text || '',
    };
  } catch (error) {
    state.error = `Receipt OCR failed: ${error.message}`;
  } finally {
    state.receiptOcrRunning = false;
    event.target.value = '';
  }
}

function parseReceiptText(text) {
  const lines = text
    .split(/\r?\n/)
    .map(cleanOcrLine)
    .filter(Boolean);
  const normalizedText = lines.join('\n');
  const amount = extractReceiptAmount(lines);
  const date = extractReceiptDate(normalizedText);
  const vendor = extractReceiptVendor(lines);
  const paymentMethod = extractPaymentMethod(normalizedText);
  const key = vendorKey(vendor);

  return {
    vendor,
    date,
    amount,
    category: (key && state.entryDefaults.vendorCategories[key]) || guessCategory(normalizedText),
    paymentMethod: (key && state.entryDefaults.vendorPaymentMethods[key]) || paymentMethod,
    notes: buildReceiptNotes(lines, { vendor, date, amount, paymentMethod }),
  };
}

function cleanOcrLine(line) {
  return line
    .replace(/[|{}[\]<>]/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\bT0TAL\b/gi, 'TOTAL')
    .replace(/\bT0T\b/gi, 'TOT')
    .replace(/\bV1SA\b/gi, 'VISA')
    .replace(/\bAM0UNT\b/gi, 'AMOUNT')
    .trim();
}

function extractReceiptAmount(lines) {
  const candidates = [];
  lines.forEach((line, index) => {
    const amounts = [...line.matchAll(/(?:\$|USD)?\s*(-?\d{1,4}(?:,\d{3})*\.\d{2})\b/gi)]
      .map((match) => Number(match[1].replaceAll(',', '')))
      .filter((value) => Number.isFinite(value) && value >= 0);
    for (const value of amounts) {
      candidates.push({
        value,
        score: receiptAmountLineScore(line, index),
      });
    }
  });

  if (!candidates.length) return '';
  candidates.sort((a, b) => b.score - a.score || b.value - a.value);
  return candidates[0].value.toFixed(2);
}

function receiptAmountLineScore(line, index) {
  const value = line.toLowerCase();
  let score = index * 0.01;
  if (/\b(grand\s+total|amount\s+due|balance\s+due|total\s+due|total|sale)\b/.test(value)) score += 80;
  if (/\b(subtotal|sub\s*total)\b/.test(value)) score += 15;
  if (/\b(tax|tip|gratuity|fee|discount|coupon|change|cash\s+tendered|tendered|refund)\b/.test(value)) score -= 60;
  if (/\b(card|visa|mastercard|amex|discover|debit|credit|paid)\b/.test(value)) score += 8;
  if (/^\s*(total|amount)\b/i.test(line)) score += 25;
  return score;
}

function extractReceiptDate(text) {
  const numericDate =
    text.match(/\b(\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/) ||
    text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/) ||
    text.match(/\b(\d{1,2}\.\d{1,2}\.\d{2,4})\b/);
  if (numericDate) return normalizeDate(numericDate[1]);

  const monthDate = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{2,4})\b/i);
  if (monthDate) return normalizeDate(`${monthNumber(monthDate[1])}/${monthDate[2]}/${monthDate[3]}`);
  return '';
}

function normalizeDate(value) {
  const normalized = value.replaceAll('-', '/').replaceAll('.', '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length !== 3) return '';
  if (parts[0]?.length === 4) {
    return validDateParts(parts[0], parts[1], parts[2]);
  }
  const year = parts[2]?.length === 2 ? `20${parts[2]}` : parts[2];
  return validDateParts(year, parts[0], parts[1]);
}

function validDateParts(year, month, day) {
  const yyyy = Number(year);
  const mm = Number(month);
  const dd = Number(day);
  if (!yyyy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
  return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function monthNumber(month) {
  return {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    sept: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  }[month.slice(0, 3).toLowerCase().replace('.', '')] || '';
}

function extractReceiptVendor(lines) {
  const vendorLine = lines.find((line) => {
    const value = line.toLowerCase();
    return (
      line.length >= 3 &&
      /[a-z]/i.test(line) &&
      !/\d{3}[-.\s]\d{3}[-.\s]\d{4}/.test(line) &&
      !/\b(receipt|invoice|order|auth|approval|terminal|merchant id|cashier|subtotal|total|tax|change|visa|mastercard|amex|debit|credit|date|time|www\.|http|thank you)\b/.test(value) &&
      !/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(line) &&
      !/\d+\.\d{2}/.test(line)
    );
  });
  return vendorLine ? titleCaseVendor(vendorLine.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')) : '';
}

function titleCaseVendor(value) {
  if (!value) return '';
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) return value.slice(0, 60);
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .slice(0, 60);
}

function extractPaymentMethod(text) {
  const value = text.toLowerCase();
  const last4 = text.match(/(?:x{2,}|\*{2,}|ending|acct|account|card)[^\d]{0,8}(\d{4})/i)?.[1];
  const suffix = last4 ? ` ending ${last4}` : '';
  if (/apple\s*pay/.test(value)) return `Apple Pay${suffix}`;
  if (/google\s*pay/.test(value)) return `Google Pay${suffix}`;
  if (/visa/.test(value)) return `Visa${suffix}`;
  if (/master\s*card|mastercard|mc\b/.test(value)) return `Mastercard${suffix}`;
  if (/amex|american express/.test(value)) return `Amex${suffix}`;
  if (/discover/.test(value)) return `Discover${suffix}`;
  if (/debit/.test(value)) return `Debit card${suffix}`;
  if (/credit/.test(value)) return `Credit card${suffix}`;
  if (/\bcash\b/.test(value)) return 'Cash';
  if (/\bcheck\b/.test(value)) return 'Check';
  return '';
}

function buildReceiptNotes(lines, parsed) {
  const blocked = [parsed.vendor, parsed.date, parsed.amount, parsed.paymentMethod].filter(Boolean).map((item) => String(item).toLowerCase());
  return lines
    .filter((line) => {
      const value = line.toLowerCase();
      return !blocked.some((item) => item && value.includes(item)) && !/\b(subtotal|total|tax|change|visa|mastercard|amex|debit|credit|cash|auth|approval)\b/.test(value);
    })
    .slice(0, 4)
    .join(' ');
}

function guessCategory(text) {
  const value = text.toLowerCase();
  if (/hotel|motel|inn|suite|lodging|marriott|hilton|hyatt|sheraton|hampton|courtyard|holiday inn/.test(value)) return 'Hotel';
  if (/gas|fuel|shell|chevron|exxon|mobil|arco|bp|76 |valero|speedway|circle k/.test(value)) return 'Fuel';
  if (/restaurant|coffee|cafe|diner|mcdonald|meal|food|denny|starbucks|subway|taco|burger|pizza|grill|kitchen|bakery/.test(value)) return 'Meals';
  if (/uber|lyft|taxi|parking|transport|shuttle|metro|airline|airport|train|rental car|hertz|avis|enterprise/.test(value)) return 'Transport';
  if (/phone|mobile|wireless|verizon|at&t|tmobile|t-mobile/.test(value)) return 'Phone';
  if (/ticket|event|entertain|movie|theater|golf/.test(value)) return 'Entertain.';
  return 'Misc.';
}

async function compressImage(file) {
  const dataUrl = await fileToDataUrl(file);
  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to prepare receipt image compression.');
  const longestSide = Math.max(image.width, image.height);
  let maxDimension = Math.min(receiptImageMaxDimension, longestSide);
  const minDimension = Math.min(receiptImageMinDimension, maxDimension);
  let blob = null;

  while (maxDimension >= minDimension) {
    const scale = Math.min(1, maxDimension / longestSide);
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.82, 0.74, 0.66, 0.58]) {
      blob = await canvasToJpegBlob(canvas, quality);
      if (blob.size <= receiptImageTargetBytes) break;
    }

    if (blob.size <= receiptImageTargetBytes || maxDimension === minDimension) break;
    maxDimension = Math.max(minDimension, Math.floor(maxDimension * 0.82));
  }

  if (!blob) throw new Error('Unable to compress receipt image.');
  if (blob.size > receiptImageMaxBytes) {
    throw new Error(`Compressed receipt is still too large (${formatBytes(blob.size)}). Please retake the photo closer to the receipt or crop it first.`);
  }

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
  };
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Unable to create compressed receipt image.'));
      },
      'image/jpeg',
      quality
    );
  });
}

function compressedReceiptFileName(name) {
  const base = (name || 'receipt').replace(/\.[^.]+$/, '') || 'receipt';
  return `${base}-compressed.jpg`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatBuildDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function startHeaderClock() {
  state.header.now = new Date();
  clockTimer = window.setInterval(() => {
    state.header.now = new Date();
  }, 1000);
}

function stopHeaderClock() {
  if (clockTimer) {
    window.clearInterval(clockTimer);
    clockTimer = null;
  }
  if (weatherTimer) {
    window.clearInterval(weatherTimer);
    weatherTimer = null;
  }
}

function startHeaderWeather() {
  if (weatherTimer) return;
  loadHeaderWeather();
  weatherTimer = window.setInterval(loadHeaderWeather, weatherRefreshMs);
}

function weatherIconClass(code, isDay = true) {
  if (code === null || code === undefined) return 'weather-cloud';
  if ([0, 1].includes(code)) return isDay ? 'weather-sun' : 'weather-night';
  if ([2, 3].includes(code)) return 'weather-cloud';
  if ([45, 48].includes(code)) return 'weather-fog';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'weather-rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'weather-snow';
  if ([95, 96, 99].includes(code)) return 'weather-storm';
  return 'weather-cloud';
}

function weatherCodeText(code) {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if ([45, 48].includes(code)) return 'Fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([95, 96, 99].includes(code)) return 'Storm';
  return 'Weather';
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 10 * 60 * 1000,
      timeout: 10000,
    });
  });
}

async function loadHeaderWeather() {
  state.header.weatherLoading = true;
  state.header.weatherError = '';
  try {
    const position = await currentPosition();
    const { latitude, longitude } = position.coords;
    const params = new URLSearchParams({
      latitude: latitude.toFixed(4),
      longitude: longitude.toFixed(4),
      current: 'temperature_2m,weather_code,is_day,wind_speed_10m',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      timezone: 'auto',
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!response.ok) throw new Error('Weather unavailable');
    const result = await response.json();
    const current = result.current || {};
    const locationLabel = await reverseGeocodeHeaderLocation(latitude, longitude).catch(() => 'Current location');
    state.header.weather = {
      temperature: Number.isFinite(current.temperature_2m) ? current.temperature_2m : null,
      condition: weatherCodeText(current.weather_code),
      code: current.weather_code,
      isDay: current.is_day !== 0,
      windMph: Number.isFinite(current.wind_speed_10m) ? current.wind_speed_10m : null,
      locationLabel,
      updatedAt: current.time || new Date().toISOString(),
    };
  } catch (error) {
    state.header.weatherError = error?.code === 1 ? 'Allow location for weather' : error.message || 'Weather unavailable';
  } finally {
    state.header.weatherLoading = false;
  }
}

async function reverseGeocodeHeaderLocation(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    localityLanguage: 'en',
  });
  const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params.toString()}`);
  if (!response.ok) throw new Error('Location unavailable');
  const result = await response.json();
  const city = result.city || result.locality || result.localityInfo?.administrative?.[0]?.name || '';
  const region = result.principalSubdivisionCode || result.principalSubdivision || '';
  if (city && region && city !== region) return `${city}, ${region}`;
  return city || region || result.countryName || 'Current location';
}

async function initializeSecurity() {
  state.entryDefaults = loadEntryDefaults();
  try {
    const payload = await apiJson('/api/auth/me');
    state.auth.setupRequired = Boolean(payload.setupRequired);
    state.auth.member = payload.member || null;
    state.auth.authenticated = Boolean(payload.authenticated && payload.member);
    state.auth.checked = true;
    if (state.auth.authenticated) {
      if (state.auth.member.role === 'admin') await loadMembers();
      await loadMemberPreferences();
      startHeaderWeather();
      await loadProjects();
    } else {
      state.loading = false;
    }
  } catch (error) {
    state.auth.checked = true;
    state.auth.authenticated = false;
    state.auth.loginError = error.message || 'Sign in is unavailable.';
    state.loading = false;
  }
}

async function loginWithAccount() {
  state.auth.loginError = '';
  state.auth.loginLoading = true;
  try {
    const payload = await apiJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: state.auth.accountNumber,
        pin: state.auth.pinInput,
      }),
    });
    state.auth.member = payload.member;
    state.auth.authenticated = true;
    state.auth.setupRequired = false;
    state.auth.pinInput = '';
    if (state.auth.member.role === 'admin') await loadMembers();
    await loadMemberPreferences();
    startHeaderWeather();
    await loadProjects();
  } catch (error) {
    state.auth.loginError = error.message;
  } finally {
    state.auth.loginLoading = false;
  }
}

async function setupFirstAdmin() {
  state.auth.loginError = '';
  state.auth.loginLoading = true;
  try {
    const payload = await apiJson('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify(state.auth.setup),
    });
    state.auth.member = payload.member;
    state.auth.authenticated = true;
    state.auth.setupRequired = false;
    state.auth.setup.pin = '';
    await loadMembers();
    await loadMemberPreferences();
    startHeaderWeather();
    await loadProjects();
  } catch (error) {
    state.auth.loginError = error.message;
  } finally {
    state.auth.loginLoading = false;
  }
}

async function logoutAccount() {
  await apiJson('/api/auth/logout', { method: 'POST' }).catch(() => null);
  state.auth.authenticated = false;
  state.auth.member = null;
  state.projects = [];
  state.currentProject = null;
  state.preferences.mileageLocations = [];
  state.mileageDrafts = [];
  state.tab = 'dashboard';
  state.loading = false;
}

function receiptCompressionText() {
  const original = state.receiptDraft.originalSize;
  const compressed = state.receiptDraft.compressedSize;
  if (!original || !compressed) return '';
  return `Compressed from ${formatBytes(original)} to ${formatBytes(compressed)} before upload.`;
}

function missingReceiptDraftFields() {
  const missing = [];
  if (!state.receiptDraft.vendor?.trim()) missing.push('vendor');
  if (!state.receiptDraft.date) missing.push('date');
  if (!Number(state.receiptDraft.amount || 0)) missing.push('amount');
  return missing;
}

function revokeReceiptPreview() {
  if (state.receiptDraft.previewUrl) URL.revokeObjectURL(state.receiptDraft.previewUrl);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function saveReceiptDraft() {
  if (!state.receiptDraft.imageBlob || !state.currentProject) return;
  if (receiptDraftMissingFields.value.length) {
    state.error = `Receipt needs ${receiptDraftMissingFields.value.join(', ')} before saving.`;
    return;
  }
  clearCrudUndo();
  state.receiptUploading = true;

  try {
    if (state.storage === 'mongodb' && !isDeviceDraft(state.currentProject)) {
      const formData = new FormData();
      formData.append('receipt', state.receiptDraft.imageBlob, state.receiptDraft.fileName || 'receipt.jpg');
      formData.append(
        'metadata',
        JSON.stringify({
          date: state.receiptDraft.date,
          vendor: state.receiptDraft.vendor,
          category: state.receiptDraft.category,
          amount: state.receiptDraft.amount,
          paymentMethod: state.receiptDraft.paymentMethod,
          notes: state.receiptDraft.notes,
          ocrText: state.receiptDraft.ocrText,
          originalImageBytes: state.receiptDraft.originalSize,
          storedImageBytes: state.receiptDraft.compressedSize,
        })
      );
      const response = await fetch(`/api/projects/${state.currentProject.id}/receipts`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Receipt upload failed.');
      state.currentProject = normalizeProject(payload.project);
      updateEntryDefaultsFromExpense(payload.expense, payload.receipt);
    } else {
      await addReceiptDraftLocally();
    }

    revokeReceiptPreview();
    state.receiptDraft = emptyReceiptDraft();
  } catch (error) {
    await addReceiptDraftLocally(error.message || 'Cloud upload failed.');
    revokeReceiptPreview();
    state.receiptDraft = emptyReceiptDraft();
    state.error = 'Receipt saved on this device and queued because cloud upload failed.';
  } finally {
    state.receiptUploading = false;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function imageToDataUrl(path) {
  const response = await fetch(path, { credentials: 'include' });
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

function receiptImageUrl(receipt) {
  if (receipt.imageDataUrl) return receipt.imageDataUrl;
  if (!state.currentProject || !receipt.imageFileId) return '';
  return `/api/projects/${state.currentProject.id}/receipts/${receipt.id}/image`;
}

async function addReceiptDraftLocally(reason = '') {
  const receiptId = newId();
  const expenseId = newId();
  const imageDataUrl = await blobToDataUrl(state.receiptDraft.imageBlob);
  const receipt = {
    id: receiptId,
    expenseId,
    date: state.receiptDraft.date,
    vendor: state.receiptDraft.vendor,
    category: state.receiptDraft.category,
    amount: Number(state.receiptDraft.amount || 0),
    paymentMethod: state.receiptDraft.paymentMethod,
    notes: state.receiptDraft.notes,
    ocrText: state.receiptDraft.ocrText,
    originalImageBytes: state.receiptDraft.originalSize,
    storedImageBytes: state.receiptDraft.compressedSize,
    imageDataUrl,
    pendingUpload: Boolean(reason),
    pendingReason: reason,
    createdAt: new Date().toISOString(),
  };
  const expense = {
    id: expenseId,
    date: state.receiptDraft.date,
    vendor: state.receiptDraft.vendor,
    description: state.receiptDraft.notes || 'Receipt expense',
    category: state.receiptDraft.category,
    amount: Number(state.receiptDraft.amount || 0),
    receiptId,
  };
  warnDuplicateExpense(expense);
  data.value.receipts.push(receipt);
  data.value.expenseRows.push(expense);
  if (reason) {
    state.receiptQueue.push({
      id: receiptId,
      vendor: receipt.vendor || 'Receipt',
      amount: receipt.amount,
      reason,
      createdAt: receipt.createdAt,
    });
  }
  updateEntryDefaultsFromExpense(expense, receipt);
  await saveCurrentProject();
}

function rowRoutePoints(row) {
  if (!row) return [];
  if (row.calculationMode === 'address-route' && row.routeGeometry?.length) return row.routeGeometry;
  if (row.routeGeometry?.length) return row.routeGeometry;
  return row.routePoints || [];
}

async function loadLeaflet() {
  if (leafletApi) return leafletApi;
  if (!leafletLoader) {
    leafletLoader = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([module]) => {
      leafletApi = module.default || module;
      return leafletApi;
    });
  }
  return leafletLoader;
}

function routePinIcon(label, color) {
  return leafletApi.divIcon({
    className: 'route-pin-icon',
    html: `<span style="background:${color}">${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

async function ensureRouteMap() {
  if (!routeMapEl.value || routeMap) return;
  const L = await loadLeaflet();
  routeMap = L.map(routeMapEl.value, {
    zoomControl: true,
    scrollWheelZoom: false,
  }).setView([39.8283, -98.5795], 4);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(routeMap);
  routeLayer = L.layerGroup().addTo(routeMap);
}

async function renderRouteMap() {
  if (state.tab !== 'mileage') return;
  await nextTick();
  if (!routeMapEl.value) return;
  await ensureRouteMap();
  if (!routeLayer || !routeMap || !leafletApi) return;
  routeLayer.clearLayers();

  const points = displayedRoutePoints.value;
  if (!points.length) {
    routeMap.setView([39.8283, -98.5795], 4);
    routeMap.invalidateSize();
    return;
  }

  const latLngs = points.map((point) => [point.lat, point.lng]);
  if (latLngs.length === 1) {
    leafletApi.marker(latLngs[0], { icon: routePinIcon('S', '#4b5a60') }).addTo(routeLayer);
    routeMap.setView(latLngs[0], 15);
  } else {
    leafletApi.polyline(latLngs, { color: '#846268', weight: 5, opacity: 0.9 }).addTo(routeLayer);
    leafletApi.marker(latLngs[0], { icon: routePinIcon('S', '#4b5a60') }).addTo(routeLayer);
    leafletApi.marker(latLngs[latLngs.length - 1], { icon: routePinIcon('E', '#846268') }).addTo(routeLayer);
    routeMap.fitBounds(latLngs, { padding: [24, 24], maxZoom: 17 });
  }

  routeMap.invalidateSize();
}

function routeMetrics(row) {
  const points = rowRoutePoints(row);
  const miles = points.length ? metersToMiles(totalRouteMeters(points)) : Number(row?.miles || 0);
  return {
    miles,
    duration: formatDuration(row?.durationSeconds || 0),
    points: points.length,
  };
}

async function exportPdf(includeReceipts = false) {
  const { jsPDF } = await import('jspdf');
  const autoTableModule = await import('jspdf-autotable');
  const autoTable = autoTableModule.default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const logo = await imageToDataUrl(logoUrl).catch(() => '');

  addConsolidatedStatementPdfPage(doc, autoTable, logo);
  addAccountingDetailPdfPage(doc, autoTable, logo);

  if (includeReceipts) {
    await addReceiptAppendix(doc, logo);
  }

  addPdfFooters(doc);
  doc.save(`${safeFileName(projectTitle(), 'accounting-package')}.pdf`);
}

function addConsolidatedStatementPdfPage(doc, autoTable, logo) {
  addPdfHeader(doc, logo, 'Consolidated Statement');
  autoTable(doc, {
    startY: pdfTableStartY,
    body: [
      ['Invoice / Report', meta.value.invoiceNumber || report.value.reportNo || 'Not set', 'Report Date', report.value.reportDate || 'Not set'],
      ['Employee / Account', `${report.value.employeeName || 'Employee'}${report.value.employeeId ? ` #${report.value.employeeId}` : ''}`, 'Client', meta.value.clientName || 'Not set'],
      ['Job / PO', [meta.value.jobNumber, meta.value.poNumber].filter(Boolean).join(' / ') || 'Not set', 'Billing Period', formatPeriod() || 'Not set'],
      ['Contact', [report.value.phone, report.value.email].filter(Boolean).join(' | '), 'Site', meta.value.siteName || meta.value.siteAddress || 'Not set'],
    ],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 5 },
    columnStyles: { 0: { fontStyle: 'bold', fillColor: [238, 242, 244] }, 2: { fontStyle: 'bold', fillColor: [238, 242, 244] } },
    margin: { bottom: 52 },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 14,
    head: [['Date Range', 'Description', 'Qty / Miles', 'Rate', 'Total']],
    body: [
      ...statementLaborRows.value.map((row) => [row.date, row.description, row.days, money.format(row.rate), money.format(row.days * row.rate)]),
      ['', 'Expense category subtotal', '', '', money.format(expenseTotal.value)],
      ['', `Mileage reimbursement (${number.format(totalMiles.value)} mi)`, number.format(totalMiles.value), mileageRateSummary(), money.format(mileageTotal.value)],
      ['', 'Total reimbursable expenses', '', '', money.format(expenseTotal.value + mileageTotal.value)],
    ],
    foot: [['', '', '', 'TOTAL DUE', money.format(totalDue.value)]],
    theme: 'grid',
    headStyles: { fillColor: [75, 90, 96] },
    footStyles: { fillColor: [132, 98, 104], fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 6 },
    margin: { bottom: 52 },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 14,
    head: [['Category', ...categories, 'Expense Total', 'Mileage Total', 'Total Due']],
    body: [['Totals', ...categories.map((category) => money.format(expenseCategoryTotals.value[category] || 0)), money.format(expenseTotal.value), money.format(mileageTotal.value), money.format(totalDue.value)]],
    theme: 'grid',
    headStyles: { fillColor: [75, 90, 96] },
    styles: { fontSize: 7, cellPadding: 4 },
    margin: { bottom: 52 },
  });
}

function addAccountingDetailPdfPage(doc, autoTable, logo) {
  doc.addPage('letter', 'landscape');
  addPdfHeader(doc, logo, 'Accounting Detail');
  autoTable(doc, {
    startY: pdfTableStartY,
    head: [['Type', '#', 'Date', 'Vendor / Route', 'Description / Purpose', 'Category / Source', 'Receipt / Rate', 'Miles', 'Amount']],
    body: accountingDetailTableRows(),
    foot: [['', '', '', '', '', '', 'Totals', number.format(totalMiles.value), money.format(expenseTotal.value + mileageTotal.value)]],
    theme: 'grid',
    headStyles: { fillColor: [75, 90, 96] },
    footStyles: { fillColor: [238, 242, 244], textColor: [23, 32, 42], fontStyle: 'bold' },
    styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 44 },
      1: { cellWidth: 28 },
      2: { cellWidth: 56 },
      3: { cellWidth: 135 },
      4: { cellWidth: 155 },
      5: { cellWidth: 78 },
      6: { cellWidth: 86 },
      7: { cellWidth: 48, halign: 'right' },
      8: { cellWidth: 62, halign: 'right' },
    },
    margin: { top: pdfTableStartY, bottom: 88 },
    didDrawPage: (hookData) => {
      if (hookData.pageNumber > 1) addPdfHeader(doc, logo, 'Accounting Detail Continued');
    },
  });

  let finalY = doc.lastAutoTable.finalY || pdfTableStartY;
  if (finalY >= 405) {
    doc.addPage('letter', 'landscape');
    addPdfHeader(doc, logo, 'Accounting Detail Continued');
    finalY = pdfTableStartY;
  }
  autoTable(doc, {
    startY: finalY + 12,
    head: [['Work Log Summary', 'Date Range', 'Entries', 'Hours', 'Representative Summary']],
    body: workLogSummaryRows.value.length
      ? workLogSummaryRows.value.map((row) => [row.label, row.dateRange, row.entries, number.format(row.hours), row.summary || ''])
      : [['No work log rows', '', '', '', '']],
    theme: 'grid',
    headStyles: { fillColor: [75, 90, 96] },
    styles: { fontSize: 7, cellPadding: 3 },
    margin: { bottom: 52 },
  });
}

function accountingDetailTableRows() {
  const expenseRows = compactExpenseRows.value.map((row) => [
    'Expense',
    row.rowNumber,
    row.date || '',
    row.vendor || '',
    row.description || '',
    row.category || '',
    row.receiptReference,
    '',
    money.format(Number(row.amount || 0)),
  ]);
  const mileageRows = compactMileageRows.value.map((row) => [
    'Mileage',
    row.rowNumber,
    row.date || '',
    [row.from, row.to].filter(Boolean).join(' -> '),
    row.purpose || '',
    row.source,
    `$${mileageRate.format(row.rate || 0)}`,
    number.format(row.miles || 0),
    money.format(row.amount),
  ]);
  return [...expenseRows, ...mileageRows].length ? [...expenseRows, ...mileageRows] : [['No detail rows', '', '', '', '', '', '', '', money.format(0)]];
}

async function exportDetailedPdf(includeReceipts = false) {
  const { jsPDF } = await import('jspdf');
  const autoTableModule = await import('jspdf-autotable');
  const autoTable = autoTableModule.default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const logo = await imageToDataUrl(logoUrl).catch(() => '');

  addPdfHeader(doc, logo, 'Expense Statement');
  autoTable(doc, {
    startY: pdfTableStartY,
    head: [['Date Range', 'Description', '# of Days', 'Daily Rate', 'Total']],
    body: [
      ...statementLaborRows.value.map((row) => [row.date, row.description, row.days, money.format(row.rate), money.format(row.days * row.rate)]),
      ['', 'Expenses', '', '', money.format(expenseTotal.value)],
      ['', `Mileage (${number.format(totalMiles.value)} mi)`, '', '', money.format(mileageTotal.value)],
      ['', 'Total expenses', '', '', money.format(expenseTotal.value + mileageTotal.value)],
      ['', '', '', 'TOTAL DUE', money.format(totalDue.value)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [75, 90, 96] },
    margin: { bottom: 52 },
  });

  doc.addPage('letter', 'landscape');
  addPdfHeader(doc, logo, 'Expense Report');
  autoTable(doc, {
    startY: pdfTableStartY,
    head: [['Date', 'Vendor', 'Description', 'Category', 'Amount']],
    body: data.value.expenseRows.map((row) => [row.date, row.vendor, row.description, row.category, money.format(Number(row.amount || 0))]),
    foot: [['', '', '', 'Total', money.format(expenseTotal.value)]],
    theme: 'grid',
    headStyles: { fillColor: [75, 90, 96] },
    margin: { bottom: 52 },
  });

  doc.addPage('letter', 'landscape');
  addPdfHeader(doc, logo, 'Work Log');
  autoTable(doc, {
    startY: pdfTableStartY,
    head: [['Date', 'Client / Site', 'Location', 'Task Category', 'Hours', 'Summary', 'Actions']],
    body: data.value.workLogs.map((row) => [row.date, row.clientSite, row.location, row.taskCategory, row.hours, row.summary, row.actions]),
    theme: 'grid',
    headStyles: { fillColor: [75, 90, 96] },
    styles: { fontSize: 8, cellWidth: 'wrap' },
    margin: { bottom: 52 },
  });

  doc.addPage('letter', 'landscape');
  addPdfHeader(doc, logo, 'Mileage Report');
  autoTable(doc, {
    startY: pdfTableStartY,
    head: [['Date', 'From', 'To', 'Purpose', 'Miles', '$ Per Mile', 'Total']],
    body: data.value.mileageRows.map((row) => [
      row.date,
      row.from,
      row.to,
      row.trackingMode === 'gps'
        ? `${row.purpose || ''} (GPS)`
        : row.calculationMode === 'address-route'
          ? `${row.purpose || ''} (Auto route)`
          : row.purpose,
      number.format(row.miles),
      `$${mileageRate.format(row.rate)}`,
      money.format(row.miles * row.rate),
    ]),
    foot: [['', '', '', 'Totals', number.format(totalMiles.value), '', money.format(mileageTotal.value)]],
    theme: 'grid',
    headStyles: { fillColor: [75, 90, 96] },
    margin: { bottom: 52 },
  });

  await addRouteMapAppendix(doc, logo);

  if (includeReceipts) {
    await addReceiptAppendix(doc, logo);
  }

  addPdfFooters(doc);
  doc.save(`${safeFileName(projectTitle(), 'expense-report')}-detailed.pdf`);
}

async function addReceiptAppendix(doc, logo) {
  const receipts = data.value.receipts;
  if (!receipts.length) return;

  const gap = 12;
  let layout = null;

  for (let index = 0; index < receipts.length; index += 1) {
    const slot = index % 4;
    if (slot === 0) {
      doc.addPage('letter', 'portrait');
      addPdfHeader(doc, logo, 'Receipt Appendix');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const tableBottom = pageHeight - 54;
      layout = {
        tableTop: pdfTableStartY,
        cellWidth: (pageWidth - pdfMargin * 2 - gap) / 2,
        cellHeight: (tableBottom - pdfTableStartY - gap) / 2,
      };
    }

    const receipt = receipts[index];
    const row = Math.floor(slot / 2);
    const column = slot % 2;
    const x = pdfMargin + column * (layout.cellWidth + gap);
    const y = layout.tableTop + row * (layout.cellHeight + gap);
    const image = await receiptImageForPdf(receipt);
    drawReceiptAppendixCell(doc, receipt, image, x, y, layout.cellWidth, layout.cellHeight);
  }
}

async function receiptImageForPdf(receipt) {
  const source = receipt.imageDataUrl || (await imageToDataUrl(receiptImageUrl(receipt)).catch(() => ''));
  if (!source) return null;
  return normalizeImageDataUrlForPdf(source).catch(() => ({ src: source, format: imageFormatForDataUrl(source) }));
}

function drawReceiptAppendixCell(doc, receipt, image, x, y, width, height) {
  const padding = 10;
  const imageTop = y + 78;
  const imageHeight = height - 92;
  const imageWidth = width - padding * 2;

  doc.setDrawColor(200, 209, 214);
  doc.setFillColor(248, 250, 251);
  doc.roundedRect(x, y, width, height, 6, 6, 'FD');
  doc.setDrawColor(216, 224, 228);
  doc.line(x, y + 70, x + width, y + 70);

  doc.setFontSize(9);
  doc.setTextColor(23, 32, 42);
  doc.text(fitPdfText(doc, receipt.vendor || 'Receipt', width - padding * 2), x + padding, y + 17);
  doc.setFontSize(7);
  doc.setTextColor(75, 90, 96);

  const detailLines = [
    `Expense row: ${receiptExpenseReference(receipt)}`,
    `Date: ${receipt.date || 'Not set'} | Category: ${receipt.category || 'Misc.'}`,
    `Amount: ${money.format(Number(receipt.amount || 0))}`,
    `Description: ${receiptDescription(receipt)}`,
  ];
  detailLines.forEach((line, index) => {
    doc.text(fitPdfText(doc, line, width - padding * 2), x + padding, y + 31 + index * 9);
  });

  doc.setDrawColor(216, 224, 228);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x + padding, imageTop, imageWidth, imageHeight, 4, 4, 'FD');
  if (image?.src) {
    drawFittedReceiptImage(doc, image.src, image.format, x + padding + 4, imageTop + 4, imageWidth - 8, imageHeight - 8);
  } else {
    doc.setFontSize(8);
    doc.setTextColor(98, 112, 120);
    doc.text('Receipt image unavailable', x + width / 2, imageTop + imageHeight / 2, { align: 'center' });
  }
}

function drawFittedReceiptImage(doc, src, format, x, y, maxWidth, maxHeight) {
  try {
    const { width, height } = doc.getImageProperties(src);
    const scale = Math.min(maxWidth / width, maxHeight / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    doc.addImage(
      src,
      format,
      x + (maxWidth - drawWidth) / 2,
      y + (maxHeight - drawHeight) / 2,
      drawWidth,
      drawHeight,
      undefined,
      'FAST',
    );
  } catch {
    doc.addImage(src, format, x, y, maxWidth, maxHeight, undefined, 'FAST');
  }
}

async function normalizeImageDataUrlForPdf(src) {
  const image = await loadImage(src);
  const canvas = document.createElement('canvas');
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { src: canvas.toDataURL('image/png'), format: 'PNG' };
}

function expenseRowIndexForReceipt(receipt) {
  return data.value.expenseRows.findIndex((row) => row.id === receipt.expenseId || row.receiptId === receipt.id);
}

function receiptExpenseReference(receipt) {
  const index = expenseRowIndexForReceipt(receipt);
  return index >= 0 ? `Expense Report row ${index + 1}` : 'Expense row not found';
}

function receiptDescription(receipt) {
  const index = expenseRowIndexForReceipt(receipt);
  const row = index >= 0 ? data.value.expenseRows[index] : null;
  return row?.description || receipt.notes || receipt.vendor || 'Receipt expense';
}

function imageFormatForDataUrl(src) {
  return /^data:image\/png/i.test(src || '') ? 'PNG' : 'JPEG';
}

async function addRouteMapAppendix(doc, logo) {
  const routeRows = data.value.mileageRows.filter((row) => rowRoutePoints(row).length > 1);
  for (const row of routeRows) {
    const points = rowRoutePoints(row);
    const mapImage = await createRouteMapImage(points).catch(() => '');
    doc.addPage('letter', 'landscape');
    addPdfHeader(doc, logo, 'Route Map Appendix');
    doc.setFontSize(10);
    doc.setTextColor(23, 32, 42);
    doc.text(`Date: ${row.date || ''}`, pdfMargin, 120);
    doc.text(`Purpose: ${row.purpose || 'GPS trip'}`, pdfMargin, 136);
    doc.text(`Miles: ${number.format(row.miles || row.distanceMiles || 0)}`, pdfMargin, 152);
    doc.text(`Source: ${row.trackingMode === 'gps' ? 'GPS trip' : 'Address route'}`, pdfMargin, 168);
    doc.text(`Duration: ${formatDuration(row.durationSeconds || 0)}`, pdfMargin, 184);
    doc.text(fitPdfText(doc, `Start: ${row.startLocation || row.from || ''}`, 250), pdfMargin, 200);
    doc.text(fitPdfText(doc, `End: ${row.endLocation || row.to || ''}`, 250), pdfMargin, 216);
    if (mapImage) {
      drawRouteMapImage(doc, mapImage, 292, 120, 456, 300);
    } else {
      drawRouteDiagram(doc, points, 292, 120, 456, 300);
    }
  }
}

function drawRouteMapImage(doc, mapImage, x, y, width, height) {
  doc.setDrawColor(200, 209, 214);
  doc.setFillColor(248, 250, 251);
  doc.roundedRect(x, y, width, height, 8, 8, 'FD');
  doc.addImage(mapImage, 'JPEG', x + 3, y + 3, width - 6, height - 6, undefined, 'FAST');
  doc.setDrawColor(200, 209, 214);
  doc.setLineWidth(1);
  doc.roundedRect(x, y, width, height, 8, 8, 'S');
}

async function createRouteMapImage(points) {
  const canvasWidth = 912;
  const canvasHeight = 600;
  const padding = 90;
  const zoom = chooseRouteMapZoom(points, canvasWidth, canvasHeight, padding);
  const center = routeMercatorCenter(points, zoom);
  const topLeft = {
    x: center.x - canvasWidth / 2,
    y: center.y - canvasHeight / 2,
  };
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext('2d');
  context.fillStyle = '#eef2ed';
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  const tileCount = await drawMapTiles(context, topLeft, zoom, canvasWidth, canvasHeight);
  if (!tileCount) throw new Error('Map tiles unavailable');

  const projected = points.map((point) => {
    const world = lonLatToWorldPixel(point.lng, point.lat, zoom);
    return {
      x: world.x - topLeft.x,
      y: world.y - topLeft.y,
    };
  });

  drawCanvasRoute(context, projected);
  drawCanvasEndpoint(context, projected[0], 'S', '#4b5a60');
  drawCanvasEndpoint(context, projected[projected.length - 1], 'E', '#846268');
  drawCanvasMapControls(context, canvasWidth, canvasHeight, zoom);

  const blob = await canvasToJpegBlob(canvas, 0.88);
  return blobToDataUrl(blob);
}

function chooseRouteMapZoom(points, width, height, padding) {
  for (let zoom = 18; zoom >= 2; zoom -= 1) {
    const bounds = routeWorldBounds(points, zoom);
    if (bounds.width <= width - padding * 2 && bounds.height <= height - padding * 2) return zoom;
  }
  return 2;
}

function routeMercatorCenter(points, zoom) {
  const bounds = routeWorldBounds(points, zoom);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function routeWorldBounds(points, zoom) {
  return points.reduce(
    (box, point) => {
      const projected = lonLatToWorldPixel(point.lng, point.lat, zoom);
      return {
        minX: Math.min(box.minX, projected.x),
        maxX: Math.max(box.maxX, projected.x),
        minY: Math.min(box.minY, projected.y),
        maxY: Math.max(box.maxY, projected.y),
        width: Math.max(box.maxX, projected.x) - Math.min(box.minX, projected.x),
        height: Math.max(box.maxY, projected.y) - Math.min(box.minY, projected.y),
      };
    },
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, width: 0, height: 0 }
  );
}

function lonLatToWorldPixel(lng, lat, zoom) {
  const tileScale = 256 * 2 ** zoom;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * tileScale,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * tileScale,
  };
}

async function drawMapTiles(context, topLeft, zoom, width, height) {
  const tileSize = 256;
  const tileLimit = 2 ** zoom;
  const minTileX = Math.floor(topLeft.x / tileSize);
  const maxTileX = Math.floor((topLeft.x + width) / tileSize);
  const minTileY = Math.max(0, Math.floor(topLeft.y / tileSize));
  const maxTileY = Math.min(tileLimit - 1, Math.floor((topLeft.y + height) / tileSize));
  let drawn = 0;

  const tileJobs = [];
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const wrappedTileX = ((tileX % tileLimit) + tileLimit) % tileLimit;
      tileJobs.push({ tileX, wrappedTileX, tileY });
    }
  }

  const tiles = await Promise.all(
    tileJobs.map(async (tile) => ({
      ...tile,
      image: await loadTileImage(`https://tile.openstreetmap.org/${zoom}/${tile.wrappedTileX}/${tile.tileY}.png`).catch(() => null),
    }))
  );

  tiles.forEach((tile) => {
    if (!tile.image) return;
    const drawX = tile.tileX * tileSize - topLeft.x;
    const drawY = tile.tileY * tileSize - topLeft.y;
    context.drawImage(tile.image, drawX, drawY, tileSize, tileSize);
    drawn += 1;
  });
  return drawn;
}

async function loadTileImage(url) {
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error('Map tile unavailable');
  const blob = await response.blob();
  return loadImage(await blobToDataUrl(blob));
}

function drawCanvasRoute(context, projected) {
  context.save();
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  context.lineWidth = 10;
  drawCanvasPolyline(context, projected);
  context.strokeStyle = '#846268';
  context.lineWidth = 5;
  drawCanvasPolyline(context, projected);
  context.restore();
}

function drawCanvasPolyline(context, projected) {
  context.beginPath();
  projected.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.stroke();
}

function drawCanvasEndpoint(context, point, label, color) {
  context.save();
  context.fillStyle = color;
  context.beginPath();
  context.arc(point.x, point.y, 18, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffffff';
  context.font = '700 18px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, point.x, point.y + 1);
  context.restore();
}

function drawCanvasMapControls(context, width, height, zoom) {
  context.save();
  context.fillStyle = 'rgba(255, 255, 255, 0.86)';
  context.fillRect(12, height - 34, 254, 22);
  context.fillStyle = '#4b5a60';
  context.font = '12px Arial, sans-serif';
  context.fillText(`OpenStreetMap road map | zoom ${zoom}`, 20, height - 18);
  context.fillStyle = 'rgba(255, 255, 255, 0.86)';
  context.fillRect(width - 54, 14, 34, 46);
  context.fillStyle = '#4b5a60';
  context.beginPath();
  context.moveTo(width - 37, 22);
  context.lineTo(width - 46, 48);
  context.lineTo(width - 28, 48);
  context.closePath();
  context.fill();
  context.font = '700 11px Arial, sans-serif';
  context.textAlign = 'center';
  context.fillText('N', width - 37, 58);
  context.restore();
}

function drawRouteDiagram(doc, points, x, y, width, height) {
  const bounds = points.reduce(
    (box, point) => ({
      minLat: Math.min(box.minLat, point.lat),
      maxLat: Math.max(box.maxLat, point.lat),
      minLng: Math.min(box.minLng, point.lng),
      maxLng: Math.max(box.maxLng, point.lng),
    }),
    { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity }
  );
  const latSpan = bounds.maxLat - bounds.minLat || 0.001;
  const lngSpan = bounds.maxLng - bounds.minLng || 0.001;
  const padding = 28;

  const project = (point) => ({
    x: x + padding + ((point.lng - bounds.minLng) / lngSpan) * (width - padding * 2),
    y: y + height - padding - ((point.lat - bounds.minLat) / latSpan) * (height - padding * 2),
  });
  const projected = points.map(project);

  drawTopographicBackground(doc, x, y, width, height);

  doc.setDrawColor(197, 210, 208);
  doc.setLineWidth(0.6);
  for (let index = 1; index < 5; index += 1) {
    const gridX = x + (width / 5) * index;
    const gridY = y + (height / 5) * index;
    doc.line(gridX, y + 12, gridX, y + height - 12);
    doc.line(x + 12, gridY, x + width - 12, gridY);
  }

  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(6);
  for (let index = 1; index < projected.length; index += 1) {
    doc.line(projected[index - 1].x, projected[index - 1].y, projected[index].x, projected[index].y);
  }
  doc.setDrawColor(132, 98, 104);
  doc.setLineWidth(3);
  for (let index = 1; index < projected.length; index += 1) {
    doc.line(projected[index - 1].x, projected[index - 1].y, projected[index].x, projected[index].y);
  }

  drawRouteEndpoint(doc, projected[0], 'S', [75, 90, 96]);
  drawRouteEndpoint(doc, projected[projected.length - 1], 'E', [132, 98, 104]);
  doc.setLineWidth(1);
}

function drawTopographicBackground(doc, x, y, width, height) {
  doc.setFillColor(238, 244, 236);
  doc.setDrawColor(200, 209, 214);
  doc.roundedRect(x, y, width, height, 8, 8, 'FD');

  drawTerrainBand(doc, [
    [x + 12, y + height * 0.76],
    [x + width * 0.23, y + height * 0.66],
    [x + width * 0.4, y + height * 0.74],
    [x + width * 0.62, y + height * 0.58],
    [x + width - 12, y + height * 0.68],
    [x + width - 12, y + height - 12],
    [x + 12, y + height - 12],
  ], [218, 229, 209]);
  drawTerrainBand(doc, [
    [x + 12, y + height * 0.32],
    [x + width * 0.28, y + height * 0.23],
    [x + width * 0.48, y + height * 0.36],
    [x + width * 0.7, y + height * 0.22],
    [x + width - 12, y + height * 0.34],
    [x + width - 12, y + height * 0.6],
    [x + 12, y + height * 0.56],
  ], [232, 225, 202]);
  drawTerrainBand(doc, [
    [x + width * 0.52, y + 12],
    [x + width - 12, y + 12],
    [x + width - 12, y + height * 0.4],
    [x + width * 0.75, y + height * 0.27],
    [x + width * 0.6, y + height * 0.36],
  ], [222, 214, 190]);
  drawTerrainBand(doc, [
    [x + 12, y + 12],
    [x + width * 0.38, y + 12],
    [x + width * 0.28, y + height * 0.26],
    [x + width * 0.12, y + height * 0.36],
    [x + 12, y + height * 0.3],
  ], [210, 225, 219]);

  drawContourLines(doc, x, y, width, height);
  doc.setDrawColor(200, 209, 214);
  doc.setLineWidth(1);
  doc.roundedRect(x, y, width, height, 8, 8, 'S');

  doc.setFontSize(7);
  doc.setTextColor(105, 118, 105);
  doc.text('Route diagram fallback', x + 14, y + height - 14);
  drawNorthArrow(doc, x + width - 34, y + 26);
}

function drawTerrainBand(doc, points, color) {
  doc.setFillColor(...color);
  const [first, ...rest] = points;
  doc.lines(rest.map((point, index) => [point[0] - points[index][0], point[1] - points[index][1]]), first[0], first[1], [1, 1], 'F', true);
}

function drawContourLines(doc, x, y, width, height) {
  doc.setLineWidth(0.5);
  for (let lineIndex = 0; lineIndex < 11; lineIndex += 1) {
    const baseY = y + 24 + lineIndex * ((height - 48) / 10);
    doc.setDrawColor(lineIndex % 2 === 0 ? 177 : 195, lineIndex % 2 === 0 ? 158 : 178, lineIndex % 2 === 0 ? 124 : 145);
    const segments = 22;
    let previous = {
      x: x + 18,
      y: baseY + Math.sin(lineIndex * 0.9) * 7,
    };
    for (let segment = 1; segment <= segments; segment += 1) {
      const nextX = x + 18 + segment * ((width - 36) / segments);
      const nextY = baseY + Math.sin(segment * 0.65 + lineIndex * 0.8) * 8 + Math.cos(segment * 0.35) * 3;
      doc.line(previous.x, previous.y, nextX, nextY);
      previous = { x: nextX, y: nextY };
    }
  }
}

function drawNorthArrow(doc, x, y) {
  doc.setFillColor(75, 90, 96);
  doc.triangle(x, y - 12, x - 6, y + 8, x + 6, y + 8, 'F');
  doc.setFontSize(7);
  doc.setTextColor(75, 90, 96);
  doc.text('N', x, y + 18, { align: 'center' });
}

function drawRouteEndpoint(doc, point, label, color) {
  doc.setFillColor(...color);
  doc.circle(point.x, point.y, 9, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.text(label, point.x, point.y + 3, { align: 'center' });
}

function addPdfHeader(doc, logo, title) {
  const pageWidth = doc.internal.pageSize.getWidth();
  if (logo) doc.addImage(logo, 'JPEG', pdfMargin, pdfHeaderTop, pdfLogoWidth, pdfLogoHeight, undefined, 'FAST');
  doc.setFontSize(18);
  doc.setTextColor(75, 90, 96);
  doc.text(title, pageWidth - pdfMargin, 62, { align: 'right' });
  doc.setDrawColor(216, 224, 228);
  doc.line(pdfMargin, pdfHeaderLineY, pageWidth - pdfMargin, pdfHeaderLineY);
}

function addPdfFooters(doc) {
  const invoiceNumber = meta.value.invoiceNumber || report.value.reportNo || 'Not set';
  const title = projectTitle();
  const date = report.value.reportDate || new Date().toISOString().slice(0, 10);
  const pageCount = doc.internal.getNumberOfPages();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const footerLineY = pageHeight - 42;
    const footerTextY = pageHeight - 26;
    const footerBrandY = pageHeight - 12;

    doc.setDrawColor(216, 224, 228);
    doc.line(pdfMargin, footerLineY, pageWidth - pdfMargin, footerLineY);
    doc.setFontSize(8);
    doc.setTextColor(75, 90, 96);
    const footerTitle = fitPdfText(doc, `Title: ${title}`, pageWidth - pdfMargin * 2 - 300);
    doc.text(`Invoice: ${invoiceNumber}`, pdfMargin, footerTextY);
    doc.text(footerTitle, pageWidth / 2, footerTextY, { align: 'center' });
    doc.text(`Date: ${date}`, pageWidth - pdfMargin, footerTextY, { align: 'right' });
    doc.setFontSize(7);
    doc.text(footerBrandText, pageWidth / 2, footerBrandY, { align: 'center' });
  }
}

function fitPdfText(doc, text, maxWidth) {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && doc.getTextWidth(`${clipped}...`) > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped.trim()}...`;
}

watch(
  () => [
    state.tab,
    state.currentProject?.id,
    state.gps.selectedMileageId,
    state.gps.routePoints.length,
    mileageForm.routeGeometry.length,
    routeMileageRows.value.length,
  ],
  () => {
    renderRouteMap();
  },
  { flush: 'post' }
);

onMounted(() => {
  window.addEventListener('beforeunload', flushLocalArchiveBeforeUnload);
  startHeaderClock();
  initializeSecurity();
});
onBeforeUnmount(() => {
  flushLocalArchive(false);
  clearAutosaveTimer();
  stopHeaderClock();
  stopGpsTripWatcher();
  revokeReceiptPreview();
  window.removeEventListener('beforeunload', flushLocalArchiveBeforeUnload);
  if (routeMap) {
    routeMap.remove();
    routeMap = null;
    routeLayer = null;
  }
});
</script>

<template>
  <main>
    <section v-if="!state.auth.checked" class="pin-gate">
      <form>
        <img :src="logoUrl" alt="Workplace Learning System" />
        <h2>Loading...</h2>
      </form>
    </section>

    <section v-else-if="!state.auth.authenticated" class="pin-gate">
      <form v-if="state.auth.setupRequired" @submit.prevent="setupFirstAdmin">
        <img :src="logoUrl" alt="Workplace Learning System" />
        <h2>Create admin account</h2>
        <input v-model="state.auth.setup.name" autocomplete="name" placeholder="Admin name" />
        <input v-model="state.auth.setup.email" type="email" autocomplete="email" placeholder="Email" spellcheck="false" />
        <input v-model="state.auth.setup.phone" autocomplete="tel" placeholder="Phone" spellcheck="false" />
        <input v-model="state.auth.setup.accountNumber" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="Optional account #" spellcheck="false" />
        <input v-model="state.auth.setup.pin" inputmode="numeric" type="password" autocomplete="new-password" placeholder="PIN" spellcheck="false" />
        <p v-if="state.auth.loginError" class="status-message gps-message">{{ state.auth.loginError }}</p>
        <button type="submit" :disabled="state.auth.loginLoading">{{ state.auth.loginLoading ? 'Creating...' : 'Create admin' }}</button>
      </form>
      <form v-else @submit.prevent="loginWithAccount">
        <img :src="logoUrl" alt="Workplace Learning System" />
        <h2>Account login</h2>
        <input v-model="state.auth.accountNumber" inputmode="numeric" maxlength="4" autocomplete="username" placeholder="Account #" spellcheck="false" />
        <input v-model="state.auth.pinInput" inputmode="numeric" type="password" autocomplete="current-password" placeholder="PIN" spellcheck="false" />
        <p v-if="state.auth.loginError" class="status-message gps-message">{{ state.auth.loginError }}</p>
        <button type="submit" :disabled="state.auth.loginLoading">{{ state.auth.loginLoading ? 'Signing in...' : 'Sign in' }}</button>
      </form>
    </section>

    <template v-else>
    <header class="app-header">
      <div class="brand-lockup">
        <img :src="logoUrl" alt="Workplace Learning System" />
        <div>
          <p class="eyebrow">Workplace Learning System</p>
          <h1>{{ state.currentProject ? projectTitle() : 'Expense Statement' }}</h1>
        </div>
      </div>
      <section class="header-live" aria-label="Current date, time, and weather">
        <div class="clock-card">
          <span>{{ headerDateText }}</span>
          <strong>{{ headerTimeText }}</strong>
        </div>
        <div class="weather-card">
          <span class="weather-graphic" :class="weatherVisualClass" aria-hidden="true">
            <i></i><b></b><em></em>
          </span>
          <div>
            <strong>{{ weatherText }}</strong>
            <span>{{ state.header.weather.locationLabel }}</span>
          </div>
        </div>
      </section>
      <div class="header-actions">
        <span class="mode-pill">{{ syncStatusText }}</span>
        <span class="mode-pill">{{ state.storage === 'mongodb' ? 'MongoDB Cloud' : 'Local fallback' }}</span>
        <button class="icon-button" type="button" title="Calculator" aria-label="Open calculator" @click="toggleCalculator">
          <span class="calculator-icon" aria-hidden="true">
            <i></i><i></i><i></i><i></i>
          </span>
        </button>
        <span class="mode-pill">#{{ state.auth.member?.accountNumber }} {{ state.auth.member?.role }}</span>
        <button class="secondary" type="button" @click="logoutAccount">Logout</button>
        <button class="secondary" type="button" @click="openPrintView">Print View</button>
        <button class="secondary" type="button" @click="exportPdf(false)">Export PDF</button>
        <button class="secondary" type="button" @click="exportPdf(true)">PDF + Receipts</button>
        <button class="secondary" type="button" @click="exportDetailedPdf(false)">Detailed PDF</button>
        <button class="secondary" type="button" @click="exportExcelPackage">Export Excel</button>
        <button class="secondary" type="button" @click="resetToBlankTemplate">Reset blank</button>
      </div>
    </header>

    <div v-if="state.calculator.open" class="calculator-overlay" role="dialog" aria-label="Calculator">
      <section class="calculator-panel">
        <header>
          <strong>Calculator</strong>
          <button class="icon" type="button" @click="closeCalculator">Close</button>
        </header>
        <div class="calculator-display">
          <span>{{ state.calculator.history }}</span>
          <strong>{{ state.calculator.display }}</strong>
        </div>
        <div class="calculator-keys">
          <button type="button" class="utility" @click="calculatorClear">C</button>
          <button type="button" class="utility" @click="calculatorToggleSign">+/-</button>
          <button type="button" class="utility" @click="calculatorPercent">%</button>
          <button type="button" class="operator" @click="calculatorChooseOperator('/')">/</button>
          <button type="button" @click="calculatorInputDigit(7)">7</button>
          <button type="button" @click="calculatorInputDigit(8)">8</button>
          <button type="button" @click="calculatorInputDigit(9)">9</button>
          <button type="button" class="operator" @click="calculatorChooseOperator('*')">x</button>
          <button type="button" @click="calculatorInputDigit(4)">4</button>
          <button type="button" @click="calculatorInputDigit(5)">5</button>
          <button type="button" @click="calculatorInputDigit(6)">6</button>
          <button type="button" class="operator" @click="calculatorChooseOperator('-')">-</button>
          <button type="button" @click="calculatorInputDigit(1)">1</button>
          <button type="button" @click="calculatorInputDigit(2)">2</button>
          <button type="button" @click="calculatorInputDigit(3)">3</button>
          <button type="button" class="operator" @click="calculatorChooseOperator('+')">+</button>
          <button type="button" @click="calculatorBackspace">Del</button>
          <button type="button" @click="calculatorInputDigit(0)">0</button>
          <button type="button" @click="calculatorInputDecimal">.</button>
          <button type="button" class="equals" @click="calculatorEquals">=</button>
        </div>
      </section>
    </div>

    <nav class="tabs" aria-label="Main views">
      <button
        v-for="[key, label] in visibleTabs"
        :key="key"
        :class="{ active: state.tab === key }"
        type="button"
        @click="state.tab = key"
      >
        {{ label }}
      </button>
    </nav>

    <p v-if="state.error" class="status-message">{{ state.error }}</p>
    <p v-if="state.duplicateWarning" class="status-message">{{ state.duplicateWarning }}</p>
    <p v-if="state.saveNotice" class="save-toast" :class="{ failed: ['MongoDB save failed', 'Cloud save failed'].includes(state.lastSaveStatus) }">{{ state.saveNotice }}</p>
    <div v-if="state.undo" class="undo-bar">
      <span>{{ state.undo.label }}</span>
      <button type="button" @click="undoLastCrudAction">Undo</button>
      <button class="secondary" type="button" @click="clearCrudUndo">Dismiss</button>
    </div>
    <p v-if="state.loading" class="loading">Loading...</p>

    <section v-else-if="state.tab === 'dashboard'" class="dashboard-view">
      <div class="dashboard-grid">
        <article><span>Active Projects</span><strong>{{ dashboardStats.active }}</strong></article>
        <article><span>Archived</span><strong>{{ dashboardStats.archived }}</strong></article>
        <article><span>Total Expenses</span><strong>{{ money.format(dashboardStats.expenses) }}</strong></article>
        <article><span>Mileage</span><strong>{{ number.format(dashboardStats.miles) }} mi</strong></article>
        <article><span>Mileage Value</span><strong>{{ money.format(dashboardStats.mileage) }}</strong></article>
        <article><span>Work Logged</span><strong>{{ number.format(dashboardStats.hours) }} hrs</strong></article>
      </div>

      <div class="dashboard-panel">
        <div class="sheet-title-row"><span>Current project</span><strong>{{ projectTitle() }}</strong></div>
        <div class="mini-summary">
          <p><span>Client</span><strong>{{ meta.clientName || 'Not set' }}</strong></p>
          <p><span>Job</span><strong>{{ meta.jobNumber || 'Not set' }}</strong></p>
          <p><span>Invoice</span><strong>{{ meta.invoiceNumber || report.reportNo || 'Not set' }}</strong></p>
          <p><span>Total Due</span><strong>{{ money.format(totalDue) }}</strong></p>
          <p><span>Last Saved</span><strong>{{ state.lastSavedAt ? formatDateTime(state.lastSavedAt) : 'Not saved' }}</strong></p>
          <p><span>Receipts Queued</span><strong>{{ state.receiptQueue.length }}</strong></p>
        </div>
      </div>

      <div class="dashboard-panel quick-entry-panel">
        <div class="sheet-title-row"><span>Quick entry</span><strong>{{ projectReviewItems.length ? `${projectReviewItems.length} review items` : 'Ready' }}</strong></div>
        <div class="quick-entry-actions">
          <button type="button" @click="goToEntry('expenses', 'receipt')">Capture receipt</button>
          <button class="secondary" type="button" @click="goToEntry('mileage')">Add mileage</button>
          <button class="secondary" type="button" @click="goToEntry('worklog')">Add work log</button>
          <button class="secondary" type="button" @click="saveDetailsToMongo">Save</button>
          <button class="secondary" type="button" @click="openPrintView">Print</button>
          <button class="secondary" type="button" @click="exportPdf(false)">PDF</button>
          <button class="secondary" type="button" @click="exportExcelPackage">Excel</button>
        </div>
        <div class="review-checklist">
          <h3>Project checklist</h3>
          <p v-if="!projectReviewItems.length" class="muted">No review items found.</p>
          <ul v-else>
            <li v-for="item in projectReviewItems.slice(0, 8)" :key="item.label" :class="item.type">{{ item.label }}</li>
          </ul>
        </div>
      </div>
    </section>

    <section v-else-if="state.currentProject && state.tab === 'print'" class="print-view">
      <div class="print-toolbar">
        <div>
          <h2>Print Preview</h2>
          <p class="muted">Review the package layout before printing.</p>
        </div>
        <div>
          <button type="button" @click="printPackage">Print Package</button>
          <button class="secondary" type="button" @click="exportPdf(false)">Export PDF</button>
          <button class="secondary" type="button" @click="exportPdf(true)">PDF + Receipts</button>
          <button class="secondary" type="button" @click="exportDetailedPdf(false)">Detailed PDF</button>
          <button class="secondary" type="button" @click="exportExcelPackage">Export Excel</button>
        </div>
      </div>

      <div class="print-package">
        <article class="print-page">
          <header class="print-page-header">
            <img :src="logoUrl" alt="Workplace Learning System" />
            <div>
              <h2>Consolidated Statement</h2>
              <p>{{ projectTitle() }}</p>
            </div>
          </header>
          <div class="statement-meta print-meta">
            <div>
              <strong>{{ report.employeeName || 'Employee' }}</strong>
              <span v-for="line in reportAddressLines" :key="`print-address-${line}`">{{ line }}</span>
              <span>{{ report.phone }}</span>
              <span>{{ report.email }}</span>
            </div>
            <dl>
              <dt>INVOICE NO.</dt><dd>{{ meta.invoiceNumber || report.reportNo }}</dd>
              <dt>CLIENT</dt><dd>{{ meta.clientName }}</dd>
              <dt>JOB / PO</dt><dd>{{ [meta.jobNumber, meta.poNumber].filter(Boolean).join(' / ') }}</dd>
              <dt>ACCOUNT #</dt><dd>{{ report.employeeId || state.auth.member?.accountNumber || 'Not set' }}</dd>
              <dt>DATE</dt><dd>{{ report.reportDate }}</dd>
              <dt>PERIOD</dt><dd>{{ formatPeriod() }}</dd>
            </dl>
          </div>
          <table class="sheet-table statement-table">
            <thead><tr><th>Date Range</th><th>Description</th><th>Qty / Miles</th><th>Rate</th><th>Total</th></tr></thead>
            <tbody>
              <tr v-for="row in statementLaborRows" :key="`print-${row.label}`">
                <td>{{ row.date }}</td>
                <td>{{ row.description }}</td>
                <td>{{ row.days }}</td>
                <td>{{ money.format(row.rate) }}</td>
                <td>{{ money.format(row.days * row.rate) }}</td>
              </tr>
              <tr><td></td><td>Expense category subtotal</td><td></td><td></td><td>{{ money.format(expenseTotal) }}</td></tr>
              <tr><td></td><td>Mileage reimbursement</td><td>{{ number.format(totalMiles) }} mi</td><td>{{ mileageRateSummary() }}</td><td>{{ money.format(mileageTotal) }}</td></tr>
              <tr><td></td><td>Total reimbursable expenses</td><td></td><td></td><td>{{ money.format(expenseTotal + mileageTotal) }}</td></tr>
            </tbody>
            <tfoot><tr><td colspan="4">TOTAL DUE</td><td>{{ money.format(totalDue) }}</td></tr></tfoot>
          </table>
          <table class="sheet-table statement-table compact-category-summary">
            <thead>
              <tr><th>Category</th><th v-for="category in categories" :key="`compact-category-${category}`">{{ category }}</th><th>Total</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Expenses</td>
                <td v-for="category in categories" :key="`compact-category-total-${category}`">{{ money.format(expenseCategoryTotals[category] || 0) }}</td>
                <td>{{ money.format(expenseTotal) }}</td>
              </tr>
            </tbody>
          </table>
          <footer class="print-footer">
            <span>Invoice: {{ meta.invoiceNumber || report.reportNo || 'Not set' }}</span>
            <span>Title: {{ projectTitle() }}</span>
            <span>Date: {{ reportPrintDate() }}</span>
            <span class="footer-brand">{{ footerBrandText }}</span>
          </footer>
        </article>

        <article class="print-page accounting-detail-page">
          <header class="print-page-header">
            <img :src="logoUrl" alt="Workplace Learning System" />
            <div>
              <h2>Accounting Detail</h2>
              <p>Expenses, mileage, and work log summary</p>
            </div>
          </header>
          <div class="table-scroll">
            <table class="sheet-table accounting-detail-table">
              <thead>
                <tr><th>Type</th><th>#</th><th>Date</th><th>Vendor / Route</th><th>Description / Purpose</th><th>Category / Source</th><th>Receipt / Rate</th><th>Miles</th><th>Amount</th></tr>
              </thead>
              <tbody>
                <tr v-for="row in compactExpenseRows" :key="`compact-expense-${row.id}`">
                  <td>Expense</td><td>{{ row.rowNumber }}</td><td>{{ row.date }}</td><td>{{ row.vendor }}</td><td>{{ row.description }}</td><td>{{ row.category }}</td><td>{{ row.receiptReference }}</td><td></td><td>{{ money.format(row.amount) }}</td>
                </tr>
                <tr v-for="row in compactMileageRows" :key="`compact-mileage-${row.id}`">
                  <td>Mileage</td><td>{{ row.rowNumber }}</td><td>{{ row.date }}</td><td>{{ [row.from, row.to].filter(Boolean).join(' -> ') }}</td><td>{{ row.purpose }}</td><td>{{ row.source }}</td><td>${{ mileageRate.format(row.rate || 0) }}</td><td>{{ number.format(row.miles) }}</td><td>{{ money.format(row.amount) }}</td>
                </tr>
              </tbody>
              <tfoot><tr><td colspan="7">TOTALS</td><td>{{ number.format(totalMiles) }}</td><td>{{ money.format(expenseTotal + mileageTotal) }}</td></tr></tfoot>
            </table>
          </div>
          <table class="sheet-table statement-table work-summary-table">
            <thead><tr><th>Work Log Summary</th><th>Date Range</th><th>Entries</th><th>Hours</th><th>Representative Summary</th></tr></thead>
            <tbody>
              <tr v-if="!workLogSummaryRows.length"><td>No work log rows</td><td></td><td></td><td></td><td></td></tr>
              <tr v-for="row in workLogSummaryRows" :key="`work-summary-${row.label}`">
                <td>{{ row.label }}</td><td>{{ row.dateRange }}</td><td>{{ row.entries }}</td><td>{{ number.format(row.hours) }}</td><td>{{ row.summary }}</td>
              </tr>
            </tbody>
          </table>
          <footer class="print-footer">
            <span>Invoice: {{ meta.invoiceNumber || report.reportNo || 'Not set' }}</span>
            <span>Title: {{ projectTitle() }}</span>
            <span>Date: {{ reportPrintDate() }}</span>
            <span class="footer-brand">{{ footerBrandText }}</span>
          </footer>
        </article>

        <article v-for="(receiptPage, pageIndex) in printReceiptPages" :key="`print-receipts-${pageIndex}`" class="print-page receipt-print-page">
          <header class="print-page-header">
            <img :src="logoUrl" alt="Workplace Learning System" />
            <div>
              <h2>Receipt Appendix</h2>
              <p>Page {{ pageIndex + 1 }} of {{ printReceiptPages.length }}</p>
            </div>
          </header>
          <div class="print-receipt-grid">
            <article v-for="receipt in receiptPage" :key="`print-receipt-${receipt.id}`" class="print-receipt-card">
              <div class="print-receipt-details">
                <h3>{{ receipt.vendor || 'Receipt' }}</h3>
                <p>Expense row: {{ receiptExpenseReference(receipt) }}</p>
                <p>Date: {{ receipt.date || 'Not set' }} | Category: {{ receipt.category || 'Misc.' }}</p>
                <p>Amount: {{ money.format(Number(receipt.amount || 0)) }}</p>
                <p>Description: {{ receiptDescription(receipt) }}</p>
              </div>
              <div class="print-receipt-image">
                <img v-if="receiptImageUrl(receipt)" :src="receiptImageUrl(receipt)" :alt="receipt.vendor || 'Receipt image'" />
                <span v-else>Receipt image unavailable</span>
              </div>
            </article>
          </div>
          <footer class="print-footer">
            <span>Invoice: {{ meta.invoiceNumber || report.reportNo || 'Not set' }}</span>
            <span>Title: {{ projectTitle() }}</span>
            <span>Date: {{ reportPrintDate() }}</span>
            <span class="footer-brand">{{ footerBrandText }}</span>
          </footer>
        </article>
      </div>
    </section>

    <section v-else-if="state.currentProject && state.tab === 'quickbooks'" class="quickbooks-view">
      <article class="quickbooks-panel">
        <div class="quickbooks-header">
          <div class="quickbooks-logo" aria-label="QuickBooks">
            <span>qb</span>
            <strong>quickbooks</strong>
          </div>
          <div>
            <h2>QuickBooks Connector</h2>
            <p class="muted">Export invoice and expense CSV files formatted for QuickBooks import.</p>
          </div>
        </div>
        <div class="connector-status">
          <p><span>Status</span><strong>CSV export ready</strong></p>
          <p><span>Invoice</span><strong>{{ meta.invoiceNumber || report.reportNo || 'Not set' }}</strong></p>
          <p><span>Customer</span><strong>{{ meta.clientName || meta.billingContact || 'Not set' }}</strong></p>
          <p><span>Total Due</span><strong>{{ money.format(totalDue) }}</strong></p>
        </div>
        <div class="quickbooks-actions">
          <button type="button" @click="exportQuickBooksInvoiceCsv">Export Invoice CSV</button>
          <button class="secondary" type="button" @click="exportQuickBooksExpensesCsv">Export Expenses CSV</button>
          <button class="secondary" type="button" @click="openPrintView">Review Print View</button>
        </div>
      </article>
    </section>

    <section v-else-if="isAdmin && state.tab === 'admin'" class="admin-view">
      <div class="admin-grid">
        <form class="admin-panel" @submit.prevent="createMember">
          <h2>Create member</h2>
          <input v-model="state.admin.form.name" required placeholder="Member name" />
          <input v-model="state.admin.form.email" type="email" placeholder="Email" spellcheck="false" />
          <input v-model="state.admin.form.phone" placeholder="Phone" spellcheck="false" />
          <select v-model="state.admin.form.role">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <input v-model="state.admin.form.pin" required inputmode="numeric" type="password" minlength="4" placeholder="Temporary PIN" spellcheck="false" />
          <button type="submit">Create account</button>
        </form>

        <section class="admin-panel">
          <div class="sheet-title-row">
            <span>Members</span>
            <button class="secondary" type="button" @click="loadMembers">Refresh</button>
          </div>
          <p v-if="state.admin.status" class="sync-status">{{ state.admin.status }}</p>
          <p v-if="state.admin.error" class="status-message">{{ state.admin.error }}</p>
          <div class="member-list">
            <article v-for="member in state.admin.members" :key="member.id" :class="{ disabled: member.status === 'disabled' }">
              <div>
                <h3>{{ member.name || 'Member' }}</h3>
                <p>#{{ member.accountNumber }} | {{ member.role }} | {{ member.status }}</p>
                <p>{{ [member.email, member.phone].filter(Boolean).join(' | ') }}</p>
              </div>
              <select :value="member.role" @change="patchMember(member, { role: $event.target.value })">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button class="secondary" type="button" @click="resetMemberPin(member)">Reset PIN</button>
              <button class="secondary" type="button" @click="toggleMemberStatus(member)">{{ member.status === 'active' ? 'Disable' : 'Reactivate' }}</button>
            </article>
          </div>
        </section>
      </div>
    </section>

    <section v-else-if="state.tab === 'archive'" class="archive-view">
      <div class="archive-toolbar">
        <h2>Project archive</h2>
        <div class="segmented-control">
          <button type="button" :class="{ active: state.archiveFilter === 'active' }" @click="state.archiveFilter = 'active'">Projects</button>
          <button type="button" :class="{ active: state.archiveFilter === 'trash' }" @click="state.archiveFilter = 'trash'">Trash</button>
        </div>
        <button class="secondary" type="button" @click="exportJsonBackup">Export JSON Backup</button>
        <button class="secondary" type="button" @click="openBackupImport">Import Backup</button>
        <input ref="backupFileInput" class="hidden-file" type="file" accept="application/json" @change="importJsonBackup" />
        <button type="button" @click="createProject()">New project</button>
      </div>
      <p v-if="state.recoveryStatus" class="sync-status">{{ state.recoveryStatus }}</p>
      <p v-if="state.archiveFilter === 'trash'" class="save-confirmation pending">Trash contains soft-deleted projects. Restore a project to edit it again.</p>
      <div class="archive-list">
        <article v-for="project in archiveProjects" :key="project.id" :class="{ selected: state.currentProject?.id === project.id }">
          <div>
            <h3>{{ projectTitle(project) }}</h3>
            <p>{{ project.status }} <span v-if="project.periodFrom">| {{ project.periodFrom }} to {{ project.periodTo }}</span></p>
            <p v-if="isAdmin">Assigned: {{ memberName(project.memberId) }}</p>
          </div>
          <select v-if="isAdmin" :value="project.memberId || ''" @change="assignProjectMember(project, $event.target.value)">
            <option value="">Unassigned</option>
            <option v-for="member in state.admin.members.filter((item) => item.status === 'active')" :key="member.id" :value="member.id">
              #{{ member.accountNumber }} {{ member.name || 'Member' }}
            </option>
          </select>
          <button v-if="project.status !== 'deleted'" class="secondary" type="button" @click="openProject(project.id)">Open</button>
          <button v-if="project.status !== 'deleted'" class="secondary" type="button" @click="renameProject(project)">Rename</button>
          <button v-if="project.status !== 'archived' && project.status !== 'deleted'" class="secondary" type="button" @click="archiveProject(project)">Archive</button>
          <button v-if="project.status === 'archived' || project.status === 'deleted'" class="secondary" type="button" @click="restoreProject(project)">Restore</button>
          <button v-if="project.status !== 'deleted'" class="danger" type="button" @click="deleteProject(project)">Delete</button>
        </article>
      </div>
    </section>

    <section v-else-if="state.currentProject && state.tab === 'statement'" class="statement-grid">
      <form class="report-form" spellcheck="true" autocapitalize="sentences" @input="scheduleAutoSave" @change="scheduleAutoSave" @submit.prevent="saveDetailsToMongo">
        <h2>Report details</h2>
        <input v-model="meta.clientName" placeholder="Client name" />
        <div class="inline-fields">
          <input v-model="meta.jobNumber" placeholder="Job number" spellcheck="false" />
          <input v-model="meta.poNumber" placeholder="PO number" spellcheck="false" />
        </div>
        <input v-model="meta.siteName" placeholder="Site / location name" />
        <input v-model="meta.siteAddress" placeholder="Site address for mileage" />
        <div class="inline-fields">
          <input v-model="meta.invoiceNumber" placeholder="Invoice number" spellcheck="false" />
          <input v-model="meta.billingContact" placeholder="Billing contact" />
        </div>
        <input v-model="meta.billingEmail" type="email" placeholder="Billing email" spellcheck="false" autocapitalize="off" />
        <input v-model="report.employeeName" placeholder="Employee name" />
        <input v-model="report.address" placeholder="Address" />
        <div class="inline-fields">
          <input v-model="report.employeeId" placeholder="Account #" spellcheck="false" :readonly="accountFieldReadonly" />
          <input v-model="report.reportNo" placeholder="Report no." spellcheck="false" />
        </div>
        <div class="inline-fields">
          <input v-model="report.phone" placeholder="Phone" spellcheck="false" />
          <input v-model="report.email" type="email" placeholder="Email" spellcheck="false" autocapitalize="off" />
        </div>
        <div class="inline-fields">
          <input v-model="report.periodFrom" type="date" />
          <input v-model="report.periodTo" type="date" />
          <input v-model="report.reportDate" type="date" />
        </div>
        <input v-model="report.engagement" placeholder="Engagement" />
        <textarea v-model="meta.notes" placeholder="Project notes"></textarea>
        <input v-model="report.laborTitle" placeholder="Labor title" />
        <div class="labor-entry">
          <h3>Onsite Work</h3>
          <div class="inline-fields">
            <input v-model="report.onsiteFrom" type="date" @change="handleLaborDateChange('onsite')" />
            <input v-model="report.onsiteTo" type="date" @change="handleLaborDateChange('onsite')" />
          </div>
          <input v-model="report.onsiteDescription" placeholder="Onsite work description" />
          <div class="inline-fields compact">
            <input v-model.number="report.onsiteDays" type="number" min="0" step="0.5" placeholder="Onsite days" />
            <input v-model.number="report.onsiteRate" type="number" min="0" step="0.01" placeholder="Onsite daily rate" />
          </div>
        </div>
        <div class="labor-entry">
          <h3>Remote Work</h3>
          <div class="inline-fields">
            <input v-model="report.remoteFrom" type="date" @change="handleLaborDateChange('remote')" />
            <input v-model="report.remoteTo" type="date" @change="handleLaborDateChange('remote')" />
          </div>
          <input v-model="report.remoteDescription" placeholder="Remote work description" />
          <div class="inline-fields compact">
            <input v-model.number="report.remoteDays" type="number" min="0" step="0.5" placeholder="Remote days" />
            <input v-model.number="report.remoteRate" type="number" min="0" step="0.01" placeholder="Remote daily rate" />
          </div>
        </div>
        <p class="save-confirmation" :class="{ cloud: ['Saved successfully', 'Autosaved', 'Saved locally', 'Autosaved locally'].includes(state.lastSaveStatus), pending: ['Autosave pending...', 'Autosaving...'].includes(state.lastSaveStatus), failed: ['MongoDB save failed', 'Cloud save failed'].includes(state.lastSaveStatus) }">
          {{ state.saving ? 'Saving...' : state.lastSaveStatus }}
        </p>
        <button type="submit" :disabled="state.saving">{{ state.saving ? 'Saving...' : 'Save' }}</button>
      </form>

      <div class="statement-sheet">
        <div class="sheet-topline">
          <img class="sheet-logo" :src="logoUrl" alt="Workplace Learning System" />
          <strong>Expense Statement</strong>
        </div>
        <div class="statement-meta">
          <div>
            <strong>{{ report.employeeName }}</strong>
            <span v-for="line in reportAddressLines" :key="`statement-address-${line}`">{{ line }}</span>
            <span>{{ report.employeeId }}</span>
            <span>{{ report.phone }}</span>
            <span>{{ report.email }}</span>
          </div>
          <dl>
            <dt>EXP. REPORT NO.</dt><dd>{{ report.reportNo }}</dd>
            <dt>INVOICE NO.</dt><dd>{{ meta.invoiceNumber }}</dd>
            <dt>CLIENT</dt><dd>{{ meta.clientName }}</dd>
            <dt>JOB / PO</dt><dd>{{ [meta.jobNumber, meta.poNumber].filter(Boolean).join(' / ') }}</dd>
            <dt>DATE</dt><dd>{{ report.reportDate }}</dd>
            <dt>ACCOUNT #</dt><dd>{{ report.employeeId }}</dd>
            <dt>PERIOD</dt><dd>{{ formatPeriod() }}</dd>
          </dl>
        </div>
        <div class="engagement-band">{{ report.engagement }}</div>
        <div class="labor-band">{{ report.laborTitle }}</div>
        <table class="sheet-table statement-table">
          <thead><tr><th>Date Range</th><th>Description</th><th># of Days</th><th>Daily Rate</th><th>Total</th></tr></thead>
          <tbody>
            <tr v-for="row in statementLaborRows" :key="row.label">
              <td>{{ row.date }}</td>
              <td>{{ row.description }}</td>
              <td>{{ row.days }}</td>
              <td>{{ money.format(row.rate) }}</td>
              <td>{{ money.format(row.days * row.rate) }}</td>
            </tr>
            <tr><td></td><td>Expenses</td><td></td><td></td><td>{{ money.format(expenseTotal) }}</td></tr>
            <tr><td></td><td>Mileage ({{ number.format(totalMiles) }} mi)</td><td></td><td></td><td>{{ money.format(mileageTotal) }}</td></tr>
            <tr><td></td><td>Total expenses</td><td></td><td></td><td>{{ money.format(expenseTotal + mileageTotal) }}</td></tr>
          </tbody>
          <tfoot><tr><td colspan="4">TOTAL DUE</td><td>{{ money.format(totalDue) }}</td></tr></tfoot>
        </table>
      </div>
    </section>

    <section v-else-if="state.currentProject && state.tab === 'expenses'" class="workbook-view">
      <div class="form-stack">
        <form spellcheck="true" autocapitalize="sentences" @submit.prevent="addExpense">
          <h2>{{ state.editing.expenseId ? 'Edit expense line' : 'Add expense line' }}</h2>
          <p v-if="state.editing.expenseId" class="save-confirmation pending">
            {{ editingLabel('expense') }}
            <button class="link-button" type="button" @click="cancelExpenseEdit">Cancel edit</button>
          </p>
          <input v-model="expenseForm.date" type="date" required />
          <input v-model="expenseForm.vendor" placeholder="Vendor" required />
          <input v-model="expenseForm.description" placeholder="Description" required />
          <select v-model="expenseForm.category">
            <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
          </select>
          <input v-model="expenseForm.amount" type="number" min="0" step="0.01" placeholder="Amount" required />
          <button type="submit">{{ state.editing.expenseId ? 'Save changes' : 'Add expense' }}</button>
        </form>

        <form class="receipt-capture" spellcheck="true" autocapitalize="sentences" @submit.prevent="saveReceiptDraft">
          <h2>Receipt OCR</h2>
          <div v-if="state.receiptQueue.length" class="receipt-queue">
            <strong>{{ state.receiptQueue.length }} receipt{{ state.receiptQueue.length === 1 ? '' : 's' }} saved locally</strong>
            <span>They will be included in the device draft backup until synced.</span>
          </div>
          <input ref="receiptFileInput" type="file" accept="image/*" capture="environment" spellcheck="false" @change="handleReceiptFile" />
          <p v-if="state.receiptOcrRunning" class="muted">Reading receipt...</p>
          <p v-if="receiptCompressionText()" class="compression-note">{{ receiptCompressionText() }}</p>
          <img v-if="state.receiptDraft.previewUrl" class="receipt-preview" :src="state.receiptDraft.previewUrl" alt="Receipt preview" />
          <input v-model="state.receiptDraft.vendor" placeholder="Vendor" />
          <input v-model="state.receiptDraft.date" type="date" />
          <select v-model="state.receiptDraft.category">
            <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
          </select>
          <input v-model="state.receiptDraft.amount" type="number" min="0" step="0.01" placeholder="Amount" />
          <input v-model="state.receiptDraft.paymentMethod" placeholder="Payment method" />
          <textarea v-model="state.receiptDraft.notes" placeholder="Notes"></textarea>
          <p v-if="state.receiptDraft.imageBlob && receiptDraftMissingFields.length" class="status-message gps-message">
            Missing {{ receiptDraftMissingFields.join(', ') }} before saving.
          </p>
          <button type="submit" :disabled="!state.receiptDraft.imageBlob || state.receiptUploading || receiptDraftMissingFields.length">
            {{ state.receiptUploading ? 'Saving receipt...' : 'Save receipt and expense' }}
          </button>
        </form>
      </div>

      <div class="sheet-panel">
        <div class="sheet-title-row"><span>Expense period</span><strong>Expense Report</strong></div>
        <div class="period-row">
          <span>From {{ report.periodFrom }}</span>
          <span>To {{ report.periodTo }}</span>
          <span>Report No. {{ report.reportNo }}</span>
        </div>
        <div class="table-scroll">
          <table class="sheet-table wide-table">
            <thead>
              <tr>
                <th>Date</th><th>Vendor</th><th>Description</th>
                <th v-for="category in categories" :key="category">{{ category }}</th>
                <th>Total</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data.expenseRows" :key="row.id">
                <td>{{ row.date }}</td><td>{{ row.vendor }}</td><td>{{ row.description }}</td>
                <td v-for="category in categories" :key="category">{{ row.category === category ? money.format(row.amount) : '' }}</td>
                <td>{{ money.format(row.amount) }}</td>
                <td>
                  <button class="icon" type="button" @click="editExpense(row)">Edit</button>
                  <button class="icon" type="button" @click="removeRow('expenseRows', row.id)">Delete</button>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3">Subtotal</td>
                <td v-for="category in categories" :key="category">{{ money.format(expenseCategoryTotals[category]) }}</td>
                <td>{{ money.format(expenseTotal) }}</td><td></td>
              </tr>
              <tr><td colspan="10">Mileage Reimbursement</td><td>{{ money.format(mileageTotal) }}</td><td></td></tr>
              <tr><td colspan="10">TOTAL</td><td>{{ money.format(expenseTotal + mileageTotal) }}</td><td></td></tr>
            </tfoot>
          </table>
        </div>

        <div class="receipt-grid">
          <article v-for="receipt in data.receipts" :key="receipt.id">
            <img v-if="receiptImageUrl(receipt)" :src="receiptImageUrl(receipt)" :alt="receipt.vendor || 'Receipt'" />
            <div>
              <h3>{{ receipt.vendor || 'Receipt' }}</h3>
              <p>{{ receipt.date }} | {{ receipt.category }} | {{ money.format(receipt.amount || 0) }}</p>
              <p class="receipt-location">{{ receiptExpenseReference(receipt) }}</p>
              <p class="receipt-description">{{ receiptDescription(receipt) }}</p>
              <button class="danger" type="button" @click="removeReceipt(receipt)">Delete receipt</button>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section v-else-if="state.currentProject && state.tab === 'mileage'" class="workbook-view">
      <div class="form-stack">
        <form spellcheck="true" autocapitalize="sentences" @submit.prevent="addMileage">
          <h2>{{ state.editing.mileageId ? 'Edit mileage' : 'Add mileage' }}</h2>
          <p v-if="state.editing.mileageId" class="save-confirmation pending">
            {{ editingLabel('mileage') }}
            <button class="link-button" type="button" @click="cancelMileageEdit">Cancel edit</button>
          </p>
          <div class="quick-route-actions">
            <button class="secondary" type="button" @click="applyQuickMileageRoute('home-to-site')">Home -> Site</button>
            <button class="secondary" type="button" @click="applyQuickMileageRoute('site-to-home')">Site -> Home</button>
            <button class="secondary" type="button" @click="applyQuickMileageRoute('hotel-to-site')">Hotel -> Site</button>
            <button class="secondary" type="button" @click="applyQuickMileageRoute('site-to-hotel')">Site -> Hotel</button>
            <button class="secondary" type="button" @click="repeatLastMileageRoute">Repeat last route</button>
            <button class="secondary" type="button" @click="addRoundTripMileage">Round trip</button>
          </div>
          <input v-model="mileageForm.date" type="date" required />
          <div class="inline-fields">
            <select v-model="mileageForm.fromSavedLocationId" @change="applySavedLocationToMileage('from', mileageForm.fromSavedLocationId)">
              <option value="">From saved location</option>
              <option v-for="location in savedMileageLocations" :key="`from-location-${location.id}`" :value="location.id">
                {{ location.label }} ({{ location.type }})
              </option>
            </select>
            <select v-model="mileageForm.toSavedLocationId" @change="applySavedLocationToMileage('to', mileageForm.toSavedLocationId)">
              <option value="">To saved location</option>
              <option v-for="location in savedMileageLocations" :key="`to-location-${location.id}`" :value="location.id">
                {{ location.label }} ({{ location.type }})
              </option>
            </select>
          </div>
          <div class="address-field">
            <input
              v-model="mileageForm.from"
              autocomplete="off"
              placeholder="From"
              required
              spellcheck="true"
              @input="handleAddressInput('from')"
            />
            <div v-if="state.places.fromSuggestions.length" class="address-suggestions">
              <button
                v-for="suggestion in state.places.fromSuggestions"
                :key="suggestion.id"
                type="button"
                @click="selectAddressSuggestion('from', suggestion)"
              >
                {{ suggestion.label }}
              </button>
            </div>
          </div>
          <div class="address-field">
            <input
              v-model="mileageForm.to"
              autocomplete="off"
              placeholder="To"
              required
              spellcheck="true"
              @input="handleAddressInput('to')"
            />
            <div v-if="state.places.toSuggestions.length" class="address-suggestions">
              <button
                v-for="suggestion in state.places.toSuggestions"
                :key="suggestion.id"
                type="button"
                @click="selectAddressSuggestion('to', suggestion)"
              >
                {{ suggestion.label }}
              </button>
            </div>
          </div>
          <input v-model="mileageForm.purpose" placeholder="Purpose" />
          <div class="inline-fields compact">
            <input v-model="mileageForm.miles" type="number" min="0" step="0.01" placeholder="Miles" required />
            <input v-model="mileageForm.rate" type="number" min="0" step="0.001" placeholder="Rate" required />
          </div>
          <p v-if="state.places.loadingField" class="muted">Looking up {{ state.places.loadingField }} address...</p>
          <p v-if="state.places.routeLoading" class="muted">Calculating driving mileage...</p>
          <p v-if="state.places.error" class="status-message gps-message">{{ state.places.error }}</p>
          <p v-if="mileageForm.calculationMode === 'address-route'" class="muted">
            Driving mileage calculated from selected addresses. Miles remain editable.
          </p>
          <button type="submit">{{ state.editing.mileageId ? 'Save changes' : 'Add mileage' }}</button>
        </form>

        <div class="gps-panel saved-locations-panel">
          <div>
            <h2>Saved locations</h2>
            <p class="muted">Locations are saved to this account and sync across devices.</p>
          </div>
          <div class="inline-fields compact">
            <select v-model="state.preferences.draftLocation.type">
              <option v-for="type in mileageLocationTypes" :key="type" :value="type">{{ type }}</option>
            </select>
            <input v-model="state.preferences.draftLocation.label" placeholder="Label" />
          </div>
          <input v-model="state.preferences.draftLocation.address" placeholder="Address" />
          <p v-if="state.preferences.error" class="status-message gps-message">{{ state.preferences.error }}</p>
          <p v-if="state.preferences.status" class="sync-status">{{ state.preferences.status }}</p>
          <button type="button" :disabled="state.preferences.saving" @click="addSavedMileageLocation">
            {{ state.preferences.saving ? 'Saving location...' : 'Save location' }}
          </button>
          <div v-if="savedMileageLocations.length" class="saved-location-list">
            <article v-for="location in savedMileageLocations" :key="location.id">
              <div>
                <strong>{{ location.label }}</strong>
                <span>{{ location.type }} | {{ location.address }}</span>
              </div>
              <button class="icon" type="button" @click="removeSavedMileageLocation(location.id)">Delete</button>
            </article>
          </div>
        </div>

        <div class="gps-panel mileage-draft-panel">
          <div>
            <h2>Work log mileage suggestions</h2>
            <p class="muted">Create reviewable mileage drafts for work-log dates without mileage.</p>
          </div>
          <button class="secondary" type="button" :disabled="state.places.routeLoading" @click="generateWorkLogMileageDrafts">
            {{ state.places.routeLoading ? 'Generating...' : 'Generate work-log mileage drafts' }}
          </button>
          <div v-if="state.mileageDrafts.length" class="mileage-draft-list">
            <label v-for="draft in state.mileageDrafts" :key="draft.id">
              <input v-model="draft.selected" type="checkbox" />
              <span>{{ draft.date }} | {{ draft.from }} -> {{ draft.to }} | {{ number.format(draft.miles) }} mi</span>
              <button class="icon" type="button" @click="selectMileageRoute(draft)">Map</button>
            </label>
            <button type="button" @click="saveSelectedMileageDrafts">Save selected drafts</button>
          </div>
        </div>

        <div class="gps-panel">
          <div>
            <h2>GPS trip capture</h2>
            <p class="muted">Track mileage while this app stays open and visible.</p>
          </div>
          <div class="gps-metrics">
            <span><strong>{{ number.format(liveGpsMiles) }}</strong> mi</span>
            <span><strong>{{ formatDuration(liveGpsDuration) }}</strong> elapsed</span>
            <span><strong>{{ state.gps.routePoints.length }}</strong> points</span>
            <span><strong>{{ state.gps.lastAccuracy ? `${state.gps.lastAccuracy}m` : '-' }}</strong> accuracy</span>
            <span><strong>{{ state.gps.paused ? 'Paused' : state.gps.active ? 'Tracking' : 'Ready' }}</strong> status</span>
            <span><strong>{{ formatDuration(state.gps.pausedSeconds) }}</strong> paused</span>
          </div>
          <p v-if="state.gps.error" class="status-message gps-message">{{ state.gps.error }}</p>
          <div class="gps-actions">
            <button type="button" :disabled="state.gps.active" @click="startGpsTrip">Start Trip</button>
            <button class="secondary" type="button" :disabled="!state.gps.active || state.gps.paused" @click="pauseGpsTrip">Pause</button>
            <button class="secondary" type="button" :disabled="!state.gps.active || !state.gps.paused" @click="resumeGpsTrip">Resume</button>
            <button class="secondary" type="button" :disabled="!state.gps.active" @click="stopGpsTrip">Stop & Save</button>
            <button class="secondary" type="button" :disabled="!state.gps.active && !state.gps.routePoints.length" @click="discardGpsTrip">Discard</button>
          </div>
        </div>
      </div>

      <div class="sheet-panel">
        <div class="mileage-layout">
          <div class="table-scroll">
            <table class="sheet-table mileage-table">
              <thead><tr><th>Type</th><th>Route</th><th>Date</th><th>From</th><th>To</th><th>Purpose</th><th>Miles</th><th>$ Per Mile</th><th>Total</th><th></th></tr></thead>
              <tbody>
                <tr v-for="row in data.mileageRows" :key="row.id" :class="{ selected: row.id === state.gps.selectedMileageId }">
                  <td>{{ row.trackingMode === 'gps' ? 'GPS' : row.calculationMode === 'address-route' ? 'Auto' : 'Manual' }}</td>
                  <td>
                    <button v-if="rowRoutePoints(row).length" class="route-thumbnail-button" type="button" title="Show route map" @click="selectMileageRoute(row)">
                      <svg viewBox="0 0 96 42" aria-hidden="true">
                        <polyline :points="routeThumbnailPolyline(rowRoutePoints(row))" />
                        <circle v-if="rowRoutePoints(row).length" :cx="routeThumbnailPolyline(rowRoutePoints(row)).split(' ')[0]?.split(',')[0]" :cy="routeThumbnailPolyline(rowRoutePoints(row)).split(' ')[0]?.split(',')[1]" r="2.8" />
                      </svg>
                    </button>
                    <span v-else class="muted">-</span>
                  </td>
                  <td>{{ row.date }}</td>
                  <td>{{ row.from }}</td>
                  <td>{{ row.to }}</td>
                  <td>{{ row.purpose }}</td>
                  <td>{{ number.format(row.miles) }}</td>
                  <td>${{ mileageRate.format(row.rate || 0) }}</td>
                  <td>{{ money.format(row.miles * row.rate) }}</td>
                  <td>
                    <button v-if="rowRoutePoints(row).length" class="icon" type="button" @click="selectMileageRoute(row)">Map</button>
                    <button class="icon" type="button" @click="editMileage(row)">Edit</button>
                    <button class="icon" type="button" @click="removeRow('mileageRows', row.id)">Delete</button>
                  </td>
                </tr>
              </tbody>
              <tfoot><tr><td colspan="6">TOTALS</td><td>{{ number.format(totalMiles) }}</td><td></td><td>{{ money.format(mileageTotal) }}</td><td></td></tr></tfoot>
            </table>
          </div>
          <aside class="summary-box">
            <h3>Trip Summary</h3>
            <p><span>Total Miles</span><strong>{{ number.format(totalMiles) }}</strong></p>
            <p><span>IRS Rate</span><strong>${{ mileageRate.format(data.mileageRows[0]?.rate || 0) }}</strong></p>
            <p><span>Total Reimbursement</span><strong>{{ money.format(mileageTotal) }}</strong></p>
            <p><span>Mapped Trips</span><strong>{{ routeMileageRows.length }}</strong></p>
          </aside>
        </div>

        <div class="route-map-panel">
          <div class="sheet-title-row">
            <span>{{ state.gps.active ? 'Live GPS route' : state.gps.selectedMileageId === 'draft-route' ? 'Calculated address route' : selectedMileageDraft ? 'Suggested mileage route' : 'Saved route' }}</span>
            <strong v-if="selectedMileageRoute && !state.gps.active">
              {{ number.format(routeMetrics(selectedMileageRoute).miles) }} mi
            </strong>
          </div>
          <div ref="routeMapEl" class="route-map" aria-label="Mileage route map"></div>
          <p v-if="!displayedRoutePoints.length" class="muted route-empty">Start a GPS trip or select addresses to calculate a route map.</p>
          <div v-else class="summary-strip route-strip">
            <span>Points <strong>{{ displayedRoutePoints.length }}</strong></span>
            <span v-if="state.gps.active">Live Miles <strong>{{ number.format(liveGpsMiles) }}</strong></span>
            <span v-else-if="selectedMileageRoute">Duration <strong>{{ routeMetrics(selectedMileageRoute).duration }}</strong></span>
          </div>
        </div>
      </div>
    </section>

    <section v-else-if="state.currentProject && state.tab === 'worklog'" class="workbook-view">
      <form class="quick-worklog-card" spellcheck="true" autocapitalize="sentences" @submit.prevent="addWorkLog">
        <div class="sheet-title-row">
          <span>{{ state.editing.workLogId ? 'Edit Work Log' : 'Daily Quick Add' }}</span>
          <strong>{{ generatedWorkLogSummary }}</strong>
        </div>
        <p v-if="state.editing.workLogId" class="save-confirmation pending">
          {{ editingLabel('workLog') }}
          <button class="link-button" type="button" @click="cancelWorkLogEdit">Cancel edit</button>
        </p>
        <div class="quick-worklog-grid">
          <label>
            <span>Date</span>
            <input v-model="workLogForm.date" type="date" required @change="handleWorkLogDateChange" />
          </label>
          <label>
            <span>Work type</span>
            <select v-model="workLogForm.taskCategory" @change="handleWorkLogTypeChange">
              <option v-for="type in workLogTypeOptions" :key="type" :value="type">{{ type }}</option>
            </select>
          </label>
          <label>
            <span>Hours</span>
            <select v-model="workLogForm.hourPreset" @change="handleWorkLogHourPresetChange">
              <option v-for="hours in workLogHourOptions" :key="hours" :value="hours">{{ hours }}</option>
            </select>
          </label>
          <label v-if="workLogForm.hourPreset === 'Custom'">
            <span>Custom hours</span>
            <input v-model="workLogForm.hours" type="number" min="0" step="0.25" required />
          </label>
          <label>
            <span>Status</span>
            <select v-model="workLogForm.status">
              <option v-for="status in workLogStatuses" :key="status" :value="status">{{ status }}</option>
            </select>
          </label>
        </div>
        <div class="quick-worklog-meta">
          <input v-model="workLogForm.clientSite" placeholder="Client / Site" required />
          <input v-model="workLogForm.location" placeholder="Location" />
        </div>
        <p v-if="workLogDateOutsideLaborRanges" class="save-confirmation pending">
          This date is outside the onsite/remote statement ranges. Review the work type before saving.
        </p>
        <div v-if="workLogDateHasExisting" class="save-confirmation pending">
          Already logged for this date.
          <button class="link-button" type="button" @click="addWorkLog({ allowDuplicate: true })">Add another entry</button>
          <button class="link-button" type="button" @click="addWorkLog({ replaceExisting: true })">Replace existing</button>
        </div>
        <button class="secondary" type="button" @click="workLogForm.showDetails = !workLogForm.showDetails">
          {{ workLogForm.showDetails ? 'Hide notes' : 'Add note / more details' }}
        </button>
        <div v-if="workLogForm.showDetails" class="quick-worklog-details">
          <textarea v-model="workLogForm.actions" placeholder="Optional notes, findings, or actions"></textarea>
          <textarea v-model="workLogForm.summary" placeholder="Optional manual summary override"></textarea>
        </div>
        <div class="quick-worklog-actions">
          <button type="submit">{{ state.editing.workLogId ? 'Save changes' : 'Add and next day' }}</button>
          <button class="secondary" type="button" :disabled="Boolean(state.editing.workLogId)" @click="addSameAsPreviousWorkLog">Add same as previous</button>
          <button class="secondary" type="button" :disabled="Boolean(state.editing.workLogId)" @click="skipWorkLogDay">Skip day</button>
          <button class="secondary" type="button" :disabled="Boolean(state.editing.workLogId)" @click="generateWorkLogDrafts">Generate weekdays from statement dates</button>
        </div>
      </form>

      <div class="sheet-panel">
        <div class="table-scroll">
          <table class="sheet-table wide-table">
            <thead><tr><th>#</th><th>Date</th><th>Client / Site</th><th>Location</th><th>Task Category</th><th>Hours</th><th>Work Summary</th><th>Key Findings / Actions</th><th>Status</th><th>Mileage</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(row, index) in data.workLogs" :key="row.id">
                <td>{{ index + 1 }}</td><td>{{ row.date }}</td><td>{{ row.clientSite }}</td><td>{{ row.location }}</td><td>{{ row.taskCategory }}</td><td>{{ row.hours }}</td><td>{{ row.summary }}</td><td>{{ row.actions }}</td><td>{{ row.status }}</td><td>{{ hasMileageForDate(row.date) ? 'Yes' : 'Missing' }}</td>
                <td>
                  <button class="icon" type="button" @click="editWorkLog(row)">Edit</button>
                  <button class="icon" type="button" @click="removeRow('workLogs', row.id)">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="summary-strip">
          <span>Total Entries <strong>{{ data.workLogs.length }}</strong></span>
          <span>Total Hours <strong>{{ number.format(totalHours) }}</strong></span>
          <span>Avg Hours/Day <strong>{{ number.format(avgHours) }}</strong></span>
        </div>
        <div class="mini-summary">
          <p v-for="(hours, category) in workLogCategoryTotals" :key="category"><span>{{ category }}</span><strong>{{ number.format(hours) }}</strong></p>
        </div>
      </div>
    </section>
    </template>
  </main>
</template>
