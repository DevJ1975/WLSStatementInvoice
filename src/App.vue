<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const archiveStorageKey = 'wls-project-archive-fallback-v1';
const archiveBackupStorageKey = 'wls-project-archive-backups-v1';
const pinHashStorageKey = 'wls-app-pin-hash-v1';
const deviceDraftPrefix = 'device-draft-';
const categories = ['Hotel', 'Transport', 'Fuel', 'Meals', 'Phone', 'Entertain.', 'Misc.'];
const tabs = [
  ['dashboard', 'Dashboard'],
  ['archive', 'Archive'],
  ['statement', 'Statement'],
  ['expenses', 'Expense Report'],
  ['mileage', 'Mileage'],
  ['worklog', 'Work Log'],
  ['print', 'Print View'],
  ['quickbooks', 'QuickBooks'],
];
const logoUrl = '/wls-logo.jpg';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const mileageRate = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
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
  duplicateWarning: '',
  receiptQueue: [],
  receiptOcrRunning: false,
  receiptUploading: false,
  receiptDraft: emptyReceiptDraft(),
  auth: {
    checked: false,
    unlocked: false,
    hasPin: false,
    pinInput: '',
    pinError: '',
  },
  gps: {
    active: false,
    watchId: null,
    startedAt: null,
    elapsedSeconds: 0,
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
});

const routeMapEl = ref(null);
const backupFileInput = ref(null);
const expenseForm = reactive({ date: '', vendor: '', description: '', category: 'Hotel', amount: '' });
const mileageForm = reactive({
  date: '',
  from: '',
  to: '',
  purpose: '',
  miles: '',
  rate: '0.725',
  fromPlace: null,
  toPlace: null,
  routeGeometry: [],
  routeDistanceMiles: 0,
  routeDurationSeconds: 0,
  calculationMode: 'manual',
});
const workLogForm = reactive({ date: '', clientSite: '', location: '', taskCategory: '', hours: '', summary: '', actions: '', status: '' });
let gpsTimer = null;
const addressTimers = {};
let routeMap = null;
let routeLayer = null;

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
const localProjectCount = computed(() => deviceDraftProjects().length);
const dashboardStats = computed(() => {
  const projects = state.projects || [];
  return {
    active: projects.filter((project) => project.status !== 'archived').length,
    archived: projects.filter((project) => project.status === 'archived').length,
    expenses: projects.reduce((sum, project) => sum + normalizeProject(project).data.expenseRows.reduce((rowSum, row) => rowSum + Number(row.amount || 0), 0), 0),
    miles: projects.reduce((sum, project) => sum + normalizeProject(project).data.mileageRows.reduce((rowSum, row) => rowSum + Number(row.miles || 0), 0), 0),
    mileage: projects.reduce((sum, project) => sum + normalizeProject(project).data.mileageRows.reduce((rowSum, row) => rowSum + Number(row.miles || 0) * Number(row.rate || 0), 0), 0),
    hours: projects.reduce((sum, project) => sum + normalizeProject(project).data.workLogs.reduce((rowSum, row) => rowSum + Number(row.hours || 0), 0), 0),
  };
});
const syncStatusText = computed(() => {
  if (state.saving) return 'Saving...';
  if (state.storage === 'mongodb') return state.lastSavedAt ? `Cloud saved ${formatDateTime(state.lastSavedAt)}` : 'Cloud sync active';
  return state.lastSavedAt ? `Saved on this device ${formatDateTime(state.lastSavedAt)}` : 'Local fallback';
});
const selectedMileageRoute = computed(() => {
  if (state.gps.selectedMileageId === 'draft-route') return null;
  return routeMileageRows.value.find((row) => row.id === state.gps.selectedMileageId) || routeMileageRows.value[0] || null;
});
const displayedRoutePoints = computed(() => {
  if (state.gps.active) return state.gps.routePoints;
  if (state.gps.selectedMileageId === 'draft-route') return mileageForm.routeGeometry;
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

function newId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function blankProjectData() {
  return {
    meta: {
      clientName: '',
      jobNumber: '',
      siteName: '',
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
  return {
    ...fallback,
    ...project,
    id: project?.id || project?._id || fallback.id,
    title: project?.title || fallback.title,
    status: project?.status || 'active',
    data: normalizeProjectData(project?.data),
  };
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

function isPersistedMongoProject(project) {
  return Boolean(project?.id && /^[a-f\d]{24}$/i.test(project.id) && !isDeviceDraft(project));
}

function deviceDraftId(project) {
  if (project.id?.startsWith(deviceDraftPrefix)) return project.id;
  return project.id?.startsWith('local-') ? project.id : `${deviceDraftPrefix}${project.id || newId()}`;
}

function asDeviceDraft(project) {
  const originalProjectId = project.originalProjectId || (project.id?.startsWith(deviceDraftPrefix) ? project.id.slice(deviceDraftPrefix.length) : project.id);
  const title = (project.title || projectTitle(project)).replace(/\s+\(device draft\)$/, '');
  return {
    ...normalizeProject(project),
    id: deviceDraftId(project),
    title: `${title} (device draft)`,
    originalProjectId,
  };
}

function uniqueProjects(projects) {
  const seen = new Set();
  return projects.filter((project) => {
    const normalized = normalizeProject(project);
    const key = `${normalized.id}:${projectDataSignature(normalized)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findDeviceDrafts(localProjects, cloudProjects) {
  const cloudSignatures = new Map(cloudProjects.map((project) => [project.id, projectDataSignature(project)]));
  return uniqueProjects(
    localProjects
      .filter(projectHasUserData)
      .filter((project) => isDeviceDraft(project) || cloudSignatures.get(project.id) !== projectDataSignature(project))
      .map(asDeviceDraft)
  ).map(normalizeProject);
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
  const drafts = projects.filter(projectHasUserData).map(asDeviceDraft);
  if (!drafts.length) return;

  const existing = JSON.parse(localStorage.getItem(archiveBackupStorageKey) || '[]');
  const backups = Array.isArray(existing) ? existing : [];
  backups.unshift({
    savedAt: new Date().toISOString(),
    projects: drafts,
  });
  localStorage.setItem(archiveBackupStorageKey, JSON.stringify(backups.slice(0, 10)));
}

function saveLocalArchive() {
  try {
    const existing = JSON.parse(localStorage.getItem(archiveStorageKey) || '{}');
    const existingProjects = Array.isArray(existing.projects) ? existing.projects : [];
    const currentSignatures = new Set(state.projects.map((project) => `${project.id}:${projectDataSignature(project)}`));
    const draftsToPreserve = existingProjects.filter((project) => projectHasUserData(project) && !currentSignatures.has(`${project.id}:${projectDataSignature(project)}`));
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
  state.lastSavedAt = new Date().toISOString();
  state.lastSaveStatus = state.storage === 'mongodb' ? 'Cached locally' : 'Saved locally';
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, {
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
    const deviceDrafts = findDeviceDrafts(localArchive.projects, cloudProjects);

    state.projects = uniqueProjects([...cloudProjects, ...deviceDrafts]).map(normalizeProject);
    state.storage = 'mongodb';

    if (deviceDrafts.length) {
      state.error = `${deviceDrafts.length} device draft${deviceDrafts.length === 1 ? '' : 's'} found. Sync device drafts to cloud before switching devices.`;
      state.recoveryStatus = 'Device drafts are available on this device. Use the green sync button to upload them.';
    }

    if (!cloudProjects.length && !deviceDrafts.length) {
      await createProject('Untitled expense project');
    } else if (deviceDrafts.some((project) => project.originalProjectId === localArchive.currentProjectId || project.id === localArchive.currentProjectId)) {
      await openProject(deviceDrafts.find((project) => project.originalProjectId === localArchive.currentProjectId || project.id === localArchive.currentProjectId).id);
    } else {
      await openProject(cloudProjects[0]?.id || state.projects[0].id);
    }
  } catch {
    state.projects = localArchive.projects.length ? localArchive.projects : [blankProject()];
    state.currentProject = state.projects.find((project) => project.id === localArchive.currentProjectId) || state.projects[0];
    refreshReceiptQueue();
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
    state.projects = [normalizeProject(payload.project), ...state.projects];
    await openProject(payload.project.id);
    return;
  }

  const project = blankProject(title);
  state.projects.unshift(project);
  state.currentProject = project;
  saveLocalArchive();
}

async function openProject(id) {
  stopGpsTripWatcher();
  if (state.storage === 'mongodb' && !isDeviceDraft({ id })) {
    const payload = await apiJson(`/api/projects/${id}`);
    state.currentProject = normalizeProject(payload.project);
    const index = state.projects.findIndex((project) => project.id === state.currentProject.id);
    if (index >= 0) state.projects[index] = { ...state.projects[index], ...state.currentProject };
    refreshReceiptQueue();
    saveLocalArchive();
    return;
  }

  state.currentProject = state.projects.find((project) => project.id === id) || state.projects[0];
  refreshReceiptQueue();
  saveLocalArchive();
}

async function saveCurrentProject(options = {}) {
  const config = options && typeof options === 'object' && ('requireCloud' in options || 'verifyCloud' in options) ? options : {};
  if (!state.currentProject) return;
  state.currentProject.title = projectTitle();
  state.currentProject.updatedAt = new Date().toISOString();
  const index = state.projects.findIndex((project) => project.id === state.currentProject.id);
  if (index >= 0) state.projects[index] = state.currentProject;
  saveLocalArchive();

  const shouldAttemptCloud = (state.storage === 'mongodb' || isPersistedMongoProject(state.currentProject)) && !isDeviceDraft(state.currentProject);
  if (!shouldAttemptCloud) {
    if (config.requireCloud) {
      state.error = 'This project is saved on this device only. Sync it to MongoDB from the Archive tab before using it across devices.';
      state.lastSaveStatus = 'MongoDB save not available for this device draft';
    }
    return;
  }

  try {
    state.saving = true;
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

    const successStatus = config.verifyCloud ? 'Verified in MongoDB' : 'Cloud saved';
    if (config.verifyCloud) {
      const confirmed = await apiJson(`/api/projects/${projectId}`);
      if (confirmed.storage !== 'mongodb' || projectDataSignature(confirmed.project) !== expectedSignature) {
        throw new Error('MongoDB verification did not match the saved document.');
      }
    }

    state.currentProject = normalizeProject(payload.project);
    state.storage = 'mongodb';
    state.error = '';
    saveLocalArchive();
    state.lastSavedAt = new Date().toISOString();
    state.lastSaveStatus = successStatus;
  } catch (error) {
    if (!isPersistedMongoProject(state.currentProject)) state.storage = 'local';
    state.error = `Saved locally only. MongoDB save failed: ${error.message}`;
    state.lastSaveStatus = 'MongoDB save failed';
  } finally {
    state.saving = false;
  }
}

async function saveDetailsToMongo() {
  await saveCurrentProject({ requireCloud: true, verifyCloud: true });
}

async function syncLocalProjectsToCloud() {
  const localProjects = deviceDraftProjects();
  if (!localProjects.length) return;

  state.syncingLocal = true;
  try {
    const replacements = new Map();
    for (const project of localProjects) {
      const title = (project.title || projectTitle(project)).replace(/\s+\(device draft\)$/, '');
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
    state.projects = state.projects.map((project) => replacements.get(project.id) || project);
    const replacement = replacements.get(currentId);
    if (replacement) {
      await openProject(replacement.id);
    } else {
      saveLocalArchive();
    }
    state.error = 'Local projects synced to cloud. You can now open this app from another device.';
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
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
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

function openPrintView() {
  state.tab = 'print';
  nextTick(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

async function printPackage() {
  state.tab = 'print';
  await nextTick();
  window.print();
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
  if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;

  if (state.storage === 'mongodb' && !isDeviceDraft(project)) {
    await apiJson(`/api/projects/${project.id}`, { method: 'DELETE' });
  }

  state.projects = state.projects.filter((item) => item.id !== project.id);
  if (state.currentProject?.id === project.id) {
    state.currentProject = state.projects[0] || null;
    if (state.currentProject && state.storage === 'mongodb') {
      await openProject(state.currentProject.id);
    }
  }

  if (!state.projects.length) {
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
  state.gps.selectedMileageId = '';
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
    id: newId(),
    date: expenseForm.date,
    vendor: expenseForm.vendor.trim(),
    description: expenseForm.description.trim(),
    category: expenseForm.category,
    amount: Number(expenseForm.amount || 0),
  };
  if (warnDuplicateExpense(row) && !window.confirm('This looks like a duplicate expense. Add it anyway?')) return;
  data.value.expenseRows.push(row);
  state.duplicateWarning = '';
  Object.assign(expenseForm, { date: '', vendor: '', description: '', category: 'Hotel', amount: '' });
  await saveCurrentProject();
}

async function addMileage() {
  const isAddressRoute = mileageForm.calculationMode === 'address-route' && mileageForm.routeGeometry.length;
  const row = {
    id: newId(),
    trackingMode: 'manual',
    calculationMode: isAddressRoute ? 'address-route' : 'manual',
    date: mileageForm.date,
    from: mileageForm.from.trim(),
    to: mileageForm.to.trim(),
    purpose: mileageForm.purpose.trim(),
    miles: Number(mileageForm.miles || 0),
    rate: Number(mileageForm.rate || 0),
    routePoints: [],
    routeGeometry: isAddressRoute ? [...mileageForm.routeGeometry] : [],
    routeDistanceMiles: isAddressRoute ? Number(mileageForm.routeDistanceMiles || mileageForm.miles || 0) : 0,
    fromPlace: isAddressRoute ? mileageForm.fromPlace : null,
    toPlace: isAddressRoute ? mileageForm.toPlace : null,
    distanceMiles: Number(mileageForm.miles || 0),
    durationSeconds: isAddressRoute ? Number(mileageForm.routeDurationSeconds || 0) : 0,
    startLocation: '',
    endLocation: '',
  };
  if (warnDuplicateMileage(row) && !window.confirm('This looks like duplicate mileage. Add it anyway?')) return;
  data.value.mileageRows.push(row);
  state.duplicateWarning = '';
  resetMileageForm();
  await saveCurrentProject();
}

function resetMileageForm() {
  Object.assign(mileageForm, {
    date: '',
    from: '',
    to: '',
    purpose: '',
    miles: '',
    rate: '0.725',
    fromPlace: null,
    toPlace: null,
    routeGeometry: [],
    routeDistanceMiles: 0,
    routeDurationSeconds: 0,
    calculationMode: 'manual',
  });
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
    const params = new URLSearchParams({
      fromLat: mileageForm.fromPlace.lat,
      fromLng: mileageForm.fromPlace.lng,
      toLat: mileageForm.toPlace.lat,
      toLng: mileageForm.toPlace.lng,
    });
    const payload = await apiJson(`/api/places/route?${params.toString()}`);
    const route = payload.route || {};
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
      state.gps.elapsedSeconds = Math.floor((Date.now() - state.gps.startedAt) / 1000);
    }
  }, 1000);
}

function stopGpsTripWatcher() {
  if (state.gps.watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.gps.watchId);
  }
  clearInterval(gpsTimer);
  gpsTimer = null;
  state.gps.watchId = null;
  state.gps.active = false;
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
  state.gps.active = true;
  startGpsTimer();

  state.gps.watchId = navigator.geolocation.watchPosition(recordGpsPosition, handleGpsError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000,
  });
}

function recordGpsPosition(position) {
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
    durationSeconds: state.gps.elapsedSeconds,
    startLocation: pointLabel(firstPoint),
    endLocation: pointLabel(lastPoint),
  };

  data.value.mileageRows.push(row);
  state.gps.selectedMileageId = row.id;
  state.gps.routePoints = [];
  state.gps.error = '';
  await saveCurrentProject();
}

function discardGpsTrip() {
  stopGpsTripWatcher();
  state.gps.routePoints = [];
  state.gps.startedAt = null;
  state.gps.elapsedSeconds = 0;
  state.gps.lastAccuracy = null;
  state.gps.error = '';
}

function selectMileageRoute(row) {
  if (rowRoutePoints(row).length) {
    state.gps.selectedMileageId = row.id;
  }
}

async function addWorkLog() {
  data.value.workLogs.push({
    id: newId(),
    date: workLogForm.date,
    clientSite: workLogForm.clientSite.trim(),
    location: workLogForm.location.trim(),
    taskCategory: workLogForm.taskCategory.trim(),
    hours: Number(workLogForm.hours || 0),
    summary: workLogForm.summary.trim(),
    actions: workLogForm.actions.trim(),
    status: workLogForm.status.trim(),
  });
  Object.assign(workLogForm, { date: '', clientSite: '', location: '', taskCategory: '', hours: '', summary: '', actions: '', status: '' });
  await saveCurrentProject();
}

async function removeRow(collection, id) {
  data.value[collection] = data.value[collection].filter((row) => row.id !== id);
  if (collection === 'expenseRows') {
    data.value.receipts = data.value.receipts.filter((receipt) => receipt.expenseId !== id);
  }
  await saveCurrentProject();
}

function hasMileageForDate(date) {
  return data.value.mileageRows.some((row) => row.date === date);
}

function formatPeriod() {
  return `${report.value.periodFrom || ''} - ${report.value.periodTo || ''}`;
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

  return {
    vendor,
    date,
    amount,
    category: guessCategory(normalizedText),
    paymentMethod,
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

async function hashPin(pin) {
  const bytes = new TextEncoder().encode(`wls-pin:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function initializeSecurity() {
  state.auth.hasPin = Boolean(localStorage.getItem(pinHashStorageKey));
  state.auth.unlocked = !state.auth.hasPin;
  state.auth.checked = true;
  if (state.auth.unlocked) {
    await loadProjects();
  } else {
    state.loading = false;
  }
}

async function unlockWithPin() {
  state.auth.pinError = '';
  const storedHash = localStorage.getItem(pinHashStorageKey);
  if (!storedHash) {
    state.auth.unlocked = true;
    await loadProjects();
    return;
  }
  if ((await hashPin(state.auth.pinInput)) !== storedHash) {
    state.auth.pinError = 'Incorrect PIN.';
    return;
  }
  state.auth.pinInput = '';
  state.auth.unlocked = true;
  await loadProjects();
}

async function setAppPin() {
  const pin = window.prompt('Set a 4+ digit app PIN for this device');
  if (!pin) return;
  if (pin.trim().length < 4) {
    state.error = 'PIN must be at least 4 digits.';
    return;
  }
  localStorage.setItem(pinHashStorageKey, await hashPin(pin.trim()));
  state.auth.hasPin = true;
  state.auth.unlocked = true;
  state.error = 'App PIN is set on this device.';
}

function clearAppPin() {
  if (!window.confirm('Remove the app PIN on this device?')) return;
  localStorage.removeItem(pinHashStorageKey);
  state.auth.hasPin = false;
  state.auth.unlocked = true;
  state.error = 'App PIN removed on this device.';
}

function receiptCompressionText() {
  const original = state.receiptDraft.originalSize;
  const compressed = state.receiptDraft.compressedSize;
  if (!original || !compressed) return '';
  return `Compressed from ${formatBytes(original)} to ${formatBytes(compressed)} before upload.`;
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
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function saveReceiptDraft() {
  if (!state.receiptDraft.imageBlob || !state.currentProject) return;
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
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Receipt upload failed.');
      state.currentProject = normalizeProject(payload.project);
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
  const response = await fetch(path);
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
  await saveCurrentProject();
}

function rowRoutePoints(row) {
  if (!row) return [];
  if (row.calculationMode === 'address-route' && row.routeGeometry?.length) return row.routeGeometry;
  if (row.routeGeometry?.length) return row.routeGeometry;
  return row.routePoints || [];
}

function routePinIcon(label, color) {
  return L.divIcon({
    className: 'route-pin-icon',
    html: `<span style="background:${color}">${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function ensureRouteMap() {
  if (!routeMapEl.value || routeMap) return;
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
  ensureRouteMap();
  routeLayer.clearLayers();

  const points = displayedRoutePoints.value;
  if (!points.length) {
    routeMap.setView([39.8283, -98.5795], 4);
    routeMap.invalidateSize();
    return;
  }

  const latLngs = points.map((point) => [point.lat, point.lng]);
  if (latLngs.length === 1) {
    L.marker(latLngs[0], { icon: routePinIcon('S', '#4b5a60') }).addTo(routeLayer);
    routeMap.setView(latLngs[0], 15);
  } else {
    L.polyline(latLngs, { color: '#846268', weight: 5, opacity: 0.9 }).addTo(routeLayer);
    L.marker(latLngs[0], { icon: routePinIcon('S', '#4b5a60') }).addTo(routeLayer);
    L.marker(latLngs[latLngs.length - 1], { icon: routePinIcon('E', '#846268') }).addTo(routeLayer);
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

  addRouteMapAppendix(doc, logo);

  if (includeReceipts) {
    for (const receipt of data.value.receipts) {
      doc.addPage('letter', 'portrait');
      addPdfHeader(doc, logo, 'Receipt Appendix');
      doc.setFontSize(10);
      doc.text(`${receipt.vendor || 'Receipt'} - ${money.format(Number(receipt.amount || 0))}`, pdfMargin, pdfTableStartY);
      const src = receipt.imageDataUrl || (await imageToDataUrl(receiptImageUrl(receipt)).catch(() => ''));
      if (src) {
        doc.addImage(src, 'JPEG', pdfMargin, 132, 500, 560, undefined, 'FAST');
      }
    }
  }

  addPdfFooters(doc);
  doc.save(`${projectTitle().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'expense-report'}.pdf`);
}

function addRouteMapAppendix(doc, logo) {
  const routeRows = data.value.mileageRows.filter((row) => rowRoutePoints(row).length > 1);
  for (const row of routeRows) {
    const points = rowRoutePoints(row);
    doc.addPage('letter', 'landscape');
    addPdfHeader(doc, logo, 'Route Map Appendix');
    doc.setFontSize(10);
    doc.setTextColor(23, 32, 42);
    doc.text(`Date: ${row.date || ''}`, pdfMargin, 120);
    doc.text(`Purpose: ${row.purpose || 'GPS trip'}`, pdfMargin, 136);
    doc.text(`Miles: ${number.format(row.miles || row.distanceMiles || 0)}`, pdfMargin, 152);
    doc.text(`Source: ${row.trackingMode === 'gps' ? 'GPS trip' : 'Address route'}`, pdfMargin, 168);
    doc.text(`Duration: ${formatDuration(row.durationSeconds || 0)}`, pdfMargin, 184);
    doc.text(`Start: ${row.startLocation || row.from || ''}`, pdfMargin, 200);
    doc.text(`End: ${row.endLocation || row.to || ''}`, pdfMargin, 216);
    drawRouteDiagram(doc, points, 292, 120, 456, 300);
  }
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

  doc.setFillColor(248, 250, 251);
  doc.setDrawColor(200, 209, 214);
  doc.roundedRect(x, y, width, height, 8, 8, 'FD');
  doc.setDrawColor(216, 224, 228);
  for (let index = 1; index < 5; index += 1) {
    const gridX = x + (width / 5) * index;
    const gridY = y + (height / 5) * index;
    doc.line(gridX, y + 12, gridX, y + height - 12);
    doc.line(x + 12, gridY, x + width - 12, gridY);
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
    const footerTextY = pageHeight - 24;

    doc.setDrawColor(216, 224, 228);
    doc.line(pdfMargin, footerLineY, pageWidth - pdfMargin, footerLineY);
    doc.setFontSize(8);
    doc.setTextColor(75, 90, 96);
    const footerTitle = fitPdfText(doc, `Title: ${title}`, pageWidth - pdfMargin * 2 - 300);
    doc.text(`Invoice: ${invoiceNumber}`, pdfMargin, footerTextY);
    doc.text(footerTitle, pageWidth / 2, footerTextY, { align: 'center' });
    doc.text(`Date: ${date}`, pageWidth - pdfMargin, footerTextY, { align: 'right' });
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

onMounted(initializeSecurity);
onBeforeUnmount(() => {
  stopGpsTripWatcher();
  revokeReceiptPreview();
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

    <section v-else-if="!state.auth.unlocked" class="pin-gate">
      <form @submit.prevent="unlockWithPin">
        <img :src="logoUrl" alt="Workplace Learning System" />
        <h2>Enter app PIN</h2>
        <input v-model="state.auth.pinInput" inputmode="numeric" type="password" autocomplete="current-password" placeholder="PIN" />
        <p v-if="state.auth.pinError" class="status-message gps-message">{{ state.auth.pinError }}</p>
        <button type="submit">Unlock</button>
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
      <div class="header-actions">
        <span class="mode-pill">{{ syncStatusText }}</span>
        <span class="mode-pill">{{ state.storage === 'mongodb' ? 'MongoDB Cloud' : 'Local fallback' }}</span>
        <button class="secondary" type="button" @click="setAppPin">{{ state.auth.hasPin ? 'Change PIN' : 'Set PIN' }}</button>
        <button v-if="state.auth.hasPin" class="secondary" type="button" @click="clearAppPin">Remove PIN</button>
        <button class="secondary" type="button" @click="openPrintView">Print View</button>
        <button class="secondary" type="button" @click="exportPdf(false)">Export PDF</button>
        <button class="secondary" type="button" @click="exportPdf(true)">PDF + Receipts</button>
        <button class="secondary" type="button" @click="resetToBlankTemplate">Reset blank</button>
      </div>
    </header>

    <nav class="tabs" aria-label="Main views">
      <button
        v-for="[key, label] in tabs"
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
        </div>
      </div>

      <div class="print-package">
        <article class="print-page">
          <header class="print-page-header">
            <img :src="logoUrl" alt="Workplace Learning System" />
            <div>
              <h2>Expense Statement</h2>
              <p>{{ projectTitle() }}</p>
            </div>
          </header>
          <div class="statement-meta print-meta">
            <div>
              <strong>{{ report.employeeName || 'Employee' }}</strong>
              <span>{{ report.address }}</span>
              <span>{{ report.phone }}</span>
              <span>{{ report.email }}</span>
            </div>
            <dl>
              <dt>INVOICE NO.</dt><dd>{{ meta.invoiceNumber || report.reportNo }}</dd>
              <dt>CLIENT</dt><dd>{{ meta.clientName }}</dd>
              <dt>JOB / PO</dt><dd>{{ [meta.jobNumber, meta.poNumber].filter(Boolean).join(' / ') }}</dd>
              <dt>DATE</dt><dd>{{ report.reportDate }}</dd>
              <dt>PERIOD</dt><dd>{{ formatPeriod() }}</dd>
            </dl>
          </div>
          <table class="sheet-table statement-table">
            <thead><tr><th>Date Range</th><th>Description</th><th># of Days</th><th>Daily Rate</th><th>Total</th></tr></thead>
            <tbody>
              <tr v-for="row in statementLaborRows" :key="`print-${row.label}`">
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
          <footer class="print-footer">
            <span>Invoice: {{ meta.invoiceNumber || report.reportNo || 'Not set' }}</span>
            <span>Title: {{ projectTitle() }}</span>
            <span>Date: {{ reportPrintDate() }}</span>
          </footer>
        </article>

        <article class="print-page">
          <header class="print-page-header">
            <img :src="logoUrl" alt="Workplace Learning System" />
            <div>
              <h2>Expense Report</h2>
              <p>{{ formatPeriod() }}</p>
            </div>
          </header>
          <div class="table-scroll">
            <table class="sheet-table wide-table">
              <thead>
                <tr>
                  <th>Date</th><th>Vendor</th><th>Description</th>
                  <th v-for="category in categories" :key="`print-category-${category}`">{{ category }}</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in data.expenseRows" :key="`print-expense-${row.id}`">
                  <td>{{ row.date }}</td><td>{{ row.vendor }}</td><td>{{ row.description }}</td>
                  <td v-for="category in categories" :key="`print-expense-${row.id}-${category}`">{{ row.category === category ? money.format(row.amount) : '' }}</td>
                  <td>{{ money.format(row.amount) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="3">Subtotal</td>
                  <td v-for="category in categories" :key="`print-total-${category}`">{{ money.format(expenseCategoryTotals[category]) }}</td>
                  <td>{{ money.format(expenseTotal) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <footer class="print-footer">
            <span>Invoice: {{ meta.invoiceNumber || report.reportNo || 'Not set' }}</span>
            <span>Title: {{ projectTitle() }}</span>
            <span>Date: {{ reportPrintDate() }}</span>
          </footer>
        </article>

        <article class="print-page">
          <header class="print-page-header">
            <img :src="logoUrl" alt="Workplace Learning System" />
            <div>
              <h2>Mileage Report</h2>
              <p>{{ number.format(totalMiles) }} total miles</p>
            </div>
          </header>
          <table class="sheet-table">
            <thead><tr><th>Date</th><th>From</th><th>To</th><th>Purpose</th><th>Miles</th><th>$ Per Mile</th><th>Total</th></tr></thead>
            <tbody>
              <tr v-for="row in data.mileageRows" :key="`print-mileage-${row.id}`">
                <td>{{ row.date }}</td>
                <td>{{ row.from }}</td>
                <td>{{ row.to }}</td>
                <td>{{ row.purpose }}</td>
                <td>{{ number.format(row.miles) }}</td>
                <td>${{ mileageRate.format(row.rate) }}</td>
                <td>{{ money.format(row.miles * row.rate) }}</td>
              </tr>
            </tbody>
            <tfoot><tr><td colspan="4">TOTALS</td><td>{{ number.format(totalMiles) }}</td><td></td><td>{{ money.format(mileageTotal) }}</td></tr></tfoot>
          </table>
          <footer class="print-footer">
            <span>Invoice: {{ meta.invoiceNumber || report.reportNo || 'Not set' }}</span>
            <span>Title: {{ projectTitle() }}</span>
            <span>Date: {{ reportPrintDate() }}</span>
          </footer>
        </article>

        <article class="print-page">
          <header class="print-page-header">
            <img :src="logoUrl" alt="Workplace Learning System" />
            <div>
              <h2>Work Log</h2>
              <p>{{ number.format(totalHours) }} total hours</p>
            </div>
          </header>
          <div class="table-scroll">
            <table class="sheet-table wide-table">
              <thead><tr><th>#</th><th>Date</th><th>Client / Site</th><th>Location</th><th>Task Category</th><th>Hours</th><th>Work Summary</th><th>Key Findings / Actions</th><th>Status</th></tr></thead>
              <tbody>
                <tr v-for="(row, index) in data.workLogs" :key="`print-work-${row.id}`">
                  <td>{{ index + 1 }}</td><td>{{ row.date }}</td><td>{{ row.clientSite }}</td><td>{{ row.location }}</td><td>{{ row.taskCategory }}</td><td>{{ row.hours }}</td><td>{{ row.summary }}</td><td>{{ row.actions }}</td><td>{{ row.status }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <footer class="print-footer">
            <span>Invoice: {{ meta.invoiceNumber || report.reportNo || 'Not set' }}</span>
            <span>Title: {{ projectTitle() }}</span>
            <span>Date: {{ reportPrintDate() }}</span>
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

    <section v-else-if="state.tab === 'archive'" class="archive-view">
      <div class="archive-toolbar">
        <h2>Project archive</h2>
        <button v-if="state.storage === 'mongodb' && localProjectCount" class="sync-cloud-button" type="button" :disabled="state.syncingLocal" @click="syncLocalProjectsToCloud">
          {{ state.syncingLocal ? 'Syncing device drafts...' : `Sync ${localProjectCount} device draft${localProjectCount === 1 ? '' : 's'} to cloud` }}
        </button>
        <button v-if="state.storage === 'mongodb'" class="secondary" type="button" @click="recheckDeviceDrafts">Recheck device storage</button>
        <button class="secondary" type="button" @click="exportJsonBackup">Export JSON Backup</button>
        <button class="secondary" type="button" @click="openBackupImport">Import Backup</button>
        <input ref="backupFileInput" class="hidden-file" type="file" accept="application/json" @change="importJsonBackup" />
        <button type="button" @click="createProject()">New project</button>
      </div>
      <p v-if="state.recoveryStatus" class="sync-status">{{ state.recoveryStatus }}</p>
      <div class="archive-list">
        <article v-for="project in state.projects" :key="project.id" :class="{ selected: state.currentProject?.id === project.id }">
          <div>
            <h3>{{ projectTitle(project) }}</h3>
            <p>{{ project.status }} <span v-if="project.periodFrom">| {{ project.periodFrom }} to {{ project.periodTo }}</span></p>
          </div>
          <button class="secondary" type="button" @click="openProject(project.id)">Open</button>
          <button class="secondary" type="button" @click="renameProject(project)">Rename</button>
          <button v-if="project.status !== 'archived'" class="secondary" type="button" @click="archiveProject(project)">Archive</button>
          <button v-else class="secondary" type="button" @click="restoreProject(project)">Restore</button>
          <button class="danger" type="button" @click="deleteProject(project)">Delete</button>
        </article>
      </div>
    </section>

    <section v-else-if="state.currentProject && state.tab === 'statement'" class="statement-grid">
      <form class="report-form" @change="saveCurrentProject" @submit.prevent="saveDetailsToMongo">
        <h2>Report details</h2>
        <input v-model="meta.clientName" placeholder="Client name" />
        <div class="inline-fields">
          <input v-model="meta.jobNumber" placeholder="Job number" />
          <input v-model="meta.poNumber" placeholder="PO number" />
        </div>
        <input v-model="meta.siteName" placeholder="Site / location name" />
        <div class="inline-fields">
          <input v-model="meta.invoiceNumber" placeholder="Invoice number" />
          <input v-model="meta.billingContact" placeholder="Billing contact" />
        </div>
        <input v-model="meta.billingEmail" type="email" placeholder="Billing email" />
        <input v-model="report.employeeName" placeholder="Employee name" />
        <input v-model="report.address" placeholder="Address" />
        <div class="inline-fields">
          <input v-model="report.employeeId" placeholder="Employee ID" />
          <input v-model="report.reportNo" placeholder="Report no." />
        </div>
        <div class="inline-fields">
          <input v-model="report.phone" placeholder="Phone" />
          <input v-model="report.email" type="email" placeholder="Email" />
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
            <input v-model="report.onsiteFrom" type="date" />
            <input v-model="report.onsiteTo" type="date" />
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
            <input v-model="report.remoteFrom" type="date" />
            <input v-model="report.remoteTo" type="date" />
          </div>
          <input v-model="report.remoteDescription" placeholder="Remote work description" />
          <div class="inline-fields compact">
            <input v-model.number="report.remoteDays" type="number" min="0" step="0.5" placeholder="Remote days" />
            <input v-model.number="report.remoteRate" type="number" min="0" step="0.01" placeholder="Remote daily rate" />
          </div>
        </div>
        <p class="save-confirmation" :class="{ cloud: state.lastSaveStatus === 'Verified in MongoDB' || state.lastSaveStatus === 'Cloud saved', failed: state.lastSaveStatus === 'MongoDB save failed' }">
          {{ state.saving ? 'Saving to MongoDB...' : state.lastSaveStatus }}
        </p>
        <button type="submit" :disabled="state.saving">{{ state.saving ? 'Saving...' : 'Save details to MongoDB' }}</button>
      </form>

      <div class="statement-sheet">
        <div class="sheet-topline">
          <img class="sheet-logo" :src="logoUrl" alt="Workplace Learning System" />
          <strong>Expense Statement</strong>
        </div>
        <div class="statement-meta">
          <div>
            <strong>{{ report.employeeName }}</strong>
            <span>{{ report.address }}</span>
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
            <dt>EMPLOYEE ID</dt><dd>{{ report.employeeId }}</dd>
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
        <form @submit.prevent="addExpense">
          <h2>Add expense line</h2>
          <input v-model="expenseForm.date" type="date" required />
          <input v-model="expenseForm.vendor" placeholder="Vendor" required />
          <input v-model="expenseForm.description" placeholder="Description" required />
          <select v-model="expenseForm.category">
            <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
          </select>
          <input v-model="expenseForm.amount" type="number" min="0" step="0.01" placeholder="Amount" required />
          <button type="submit">Add expense</button>
        </form>

        <form class="receipt-capture" @submit.prevent="saveReceiptDraft">
          <h2>Receipt OCR</h2>
          <div v-if="state.receiptQueue.length" class="receipt-queue">
            <strong>{{ state.receiptQueue.length }} receipt{{ state.receiptQueue.length === 1 ? '' : 's' }} saved locally</strong>
            <span>They will be included in the device draft backup until synced.</span>
          </div>
          <input type="file" accept="image/*" capture="environment" @change="handleReceiptFile" />
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
          <button type="submit" :disabled="!state.receiptDraft.imageBlob || state.receiptUploading">
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
                <td><button class="icon" type="button" @click="removeRow('expenseRows', row.id)">Delete</button></td>
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
            </div>
          </article>
        </div>
      </div>
    </section>

    <section v-else-if="state.currentProject && state.tab === 'mileage'" class="workbook-view">
      <div class="form-stack">
        <form @submit.prevent="addMileage">
          <h2>Add mileage</h2>
          <input v-model="mileageForm.date" type="date" required />
          <div class="address-field">
            <input
              v-model="mileageForm.from"
              autocomplete="off"
              placeholder="From"
              required
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
          <button type="submit">Add mileage</button>
        </form>

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
          </div>
          <p v-if="state.gps.error" class="status-message gps-message">{{ state.gps.error }}</p>
          <div class="gps-actions">
            <button type="button" :disabled="state.gps.active" @click="startGpsTrip">Start Trip</button>
            <button class="secondary" type="button" :disabled="!state.gps.active" @click="stopGpsTrip">Stop & Save</button>
            <button class="secondary" type="button" :disabled="!state.gps.active && !state.gps.routePoints.length" @click="discardGpsTrip">Discard</button>
          </div>
        </div>
      </div>

      <div class="sheet-panel">
        <div class="mileage-layout">
          <div class="table-scroll">
            <table class="sheet-table mileage-table">
              <thead><tr><th>Type</th><th>Date</th><th>From</th><th>To</th><th>Purpose</th><th>Miles</th><th>$ Per Mile</th><th>Total</th><th></th></tr></thead>
              <tbody>
                <tr v-for="row in data.mileageRows" :key="row.id" :class="{ selected: row.id === state.gps.selectedMileageId }">
                  <td>{{ row.trackingMode === 'gps' ? 'GPS' : row.calculationMode === 'address-route' ? 'Auto' : 'Manual' }}</td>
                  <td><input class="table-input" v-model="row.date" type="date" @change="saveCurrentProject" /></td>
                  <td><input class="table-input" v-model="row.from" @change="saveCurrentProject" /></td>
                  <td><input class="table-input" v-model="row.to" @change="saveCurrentProject" /></td>
                  <td><input class="table-input" v-model="row.purpose" @change="saveCurrentProject" /></td>
                  <td><input class="table-input number-input" v-model.number="row.miles" type="number" min="0" step="0.01" @change="saveCurrentProject" /></td>
                  <td><input class="table-input number-input" v-model.number="row.rate" type="number" min="0" step="0.001" @change="saveCurrentProject" /></td>
                  <td>{{ money.format(row.miles * row.rate) }}</td>
                  <td>
                    <button v-if="rowRoutePoints(row).length" class="icon" type="button" @click="selectMileageRoute(row)">Map</button>
                    <button class="icon" type="button" @click="removeRow('mileageRows', row.id)">Delete</button>
                  </td>
                </tr>
              </tbody>
              <tfoot><tr><td colspan="5">TOTALS</td><td>{{ number.format(totalMiles) }}</td><td></td><td>{{ money.format(mileageTotal) }}</td><td></td></tr></tfoot>
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
            <span>{{ state.gps.active ? 'Live GPS route' : state.gps.selectedMileageId === 'draft-route' ? 'Calculated address route' : 'Saved route' }}</span>
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
      <form @submit.prevent="addWorkLog">
        <h2>Add work log</h2>
        <input v-model="workLogForm.date" type="date" required />
        <input v-model="workLogForm.clientSite" placeholder="Client / Site" required />
        <input v-model="workLogForm.location" placeholder="Location" />
        <input v-model="workLogForm.taskCategory" placeholder="Task category" />
        <input v-model="workLogForm.hours" type="number" min="0" step="0.25" placeholder="Hours" required />
        <textarea v-model="workLogForm.summary" placeholder="Work summary"></textarea>
        <textarea v-model="workLogForm.actions" placeholder="Key findings / actions"></textarea>
        <input v-model="workLogForm.status" placeholder="Status" />
        <button type="submit">Add work log</button>
      </form>

      <div class="sheet-panel">
        <div class="table-scroll">
          <table class="sheet-table wide-table">
            <thead><tr><th>#</th><th>Date</th><th>Client / Site</th><th>Location</th><th>Task Category</th><th>Hours</th><th>Work Summary</th><th>Key Findings / Actions</th><th>Status</th><th>Mileage</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(row, index) in data.workLogs" :key="row.id">
                <td>{{ index + 1 }}</td><td>{{ row.date }}</td><td>{{ row.clientSite }}</td><td>{{ row.location }}</td><td>{{ row.taskCategory }}</td><td>{{ row.hours }}</td><td>{{ row.summary }}</td><td>{{ row.actions }}</td><td>{{ row.status }}</td><td>{{ hasMileageForDate(row.date) ? 'Yes' : 'Missing' }}</td>
                <td><button class="icon" type="button" @click="removeRow('workLogs', row.id)">Delete</button></td>
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
