<script setup>
import { computed, onMounted, reactive } from 'vue';

const storageKey = 'wls-statement-invoice-fallback-v1';
const categories = ['Hotel', 'Transport', 'Fuel', 'Meals', 'Phone', 'Entertain.', 'Misc.'];
const tabs = [
  ['statement', 'Statement'],
  ['expenses', 'Expense Report'],
  ['mileage', 'Mileage'],
  ['worklog', 'Work Log'],
  ['receipts', 'Receipts'],
];

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const mileageRate = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function newId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultData() {
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

const state = reactive({
  loading: true,
  saving: false,
  storage: 'loading',
  error: '',
  tab: 'statement',
  data: defaultData(),
});

const expenseForm = reactive({ date: '', vendor: '', description: '', category: 'Hotel', amount: '' });
const mileageForm = reactive({ date: '', from: '', to: '', purpose: '', miles: '', rate: '0.725' });
const workLogForm = reactive({ date: '', clientSite: '', location: '', taskCategory: '', hours: '', summary: '', actions: '', status: '' });
const receiptForm = reactive({ date: '', vendor: '', category: 'Hotel', amount: '', paymentMethod: '', notes: '' });

const laborTotal = computed(() => Number(state.data.report.laborDays || 0) * Number(state.data.report.dailyRate || 0));
const expenseTotal = computed(() => state.data.expenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
const mileageTotal = computed(() => state.data.mileageRows.reduce((sum, row) => sum + Number(row.miles || 0) * Number(row.rate || 0), 0));
const totalMiles = computed(() => state.data.mileageRows.reduce((sum, row) => sum + Number(row.miles || 0), 0));
const totalDue = computed(() => laborTotal.value + expenseTotal.value + mileageTotal.value);
const receiptTotal = computed(() => state.data.receipts.reduce((sum, row) => sum + Number(row.amount || 0), 0));
const totalHours = computed(() => state.data.workLogs.reduce((sum, row) => sum + Number(row.hours || 0), 0));
const avgHours = computed(() => (state.data.workLogs.length ? totalHours.value / state.data.workLogs.length : 0));

const expenseCategoryTotals = computed(() => categoryTotals(state.data.expenseRows));
const receiptCategoryTotals = computed(() => categoryTotals(state.data.receipts));
const workLogCategoryTotals = computed(() =>
  state.data.workLogs.reduce((totals, row) => {
    const key = row.taskCategory || 'Uncategorized';
    totals[key] = (totals[key] || 0) + Number(row.hours || 0);
    return totals;
  }, {})
);

function categoryTotals(rows) {
  return categories.reduce((totals, category) => {
    totals[category] = rows
      .filter((row) => row.category === category)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return totals;
  }, {});
}

function loadData() {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return defaultData();

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.report || !Array.isArray(parsed.expenseRows)) return defaultData();
    return parsed;
  } catch {
    return defaultData();
  }
}

function normalizeData(data) {
  const blank = defaultData();
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

function saveLocalFallback() {
  localStorage.setItem(storageKey, JSON.stringify(state.data));
}

async function fetchData() {
  state.loading = true;
  state.error = '';

  try {
    const response = await fetch('/api/report', { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error('MongoDB API is unavailable.');
    }

    const payload = await response.json();
    state.data = normalizeData(payload.data);
    state.storage = 'mongodb';
    saveLocalFallback();
  } catch (error) {
    state.data = normalizeData(loadData());
    state.storage = 'local';
    state.error = 'Using local fallback. MongoDB sync is unavailable in this session.';
  } finally {
    state.loading = false;
  }
}

async function saveData() {
  saveLocalFallback();

  try {
    state.saving = true;
    const response = await fetch('/api/report', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: state.data }),
    });

    if (!response.ok) {
      throw new Error('MongoDB API save failed.');
    }

    const payload = await response.json();
    state.data = normalizeData(payload.data);
    state.storage = 'mongodb';
    state.error = '';
    saveLocalFallback();
  } catch (error) {
    state.storage = 'local';
    state.error = 'Saved locally only. MongoDB sync is unavailable in this session.';
  } finally {
    state.saving = false;
  }
}

async function resetToBlankTemplate() {
  state.data = defaultData();
  await saveData();
}

async function addExpense() {
  state.data.expenseRows.push({
    id: newId(),
    date: expenseForm.date,
    vendor: expenseForm.vendor.trim(),
    description: expenseForm.description.trim(),
    category: expenseForm.category,
    amount: Number(expenseForm.amount || 0),
  });
  Object.assign(expenseForm, { date: '', vendor: '', description: '', category: 'Hotel', amount: '' });
  await saveData();
}

async function addMileage() {
  state.data.mileageRows.push({
    id: newId(),
    date: mileageForm.date,
    from: mileageForm.from.trim(),
    to: mileageForm.to.trim(),
    purpose: mileageForm.purpose.trim(),
    miles: Number(mileageForm.miles || 0),
    rate: Number(mileageForm.rate || 0),
  });
  Object.assign(mileageForm, { date: '', from: '', to: '', purpose: '', miles: '', rate: '0.725' });
  await saveData();
}

async function addWorkLog() {
  state.data.workLogs.push({
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
  await saveData();
}

async function addReceipt() {
  state.data.receipts.push({
    id: newId(),
    date: receiptForm.date,
    vendor: receiptForm.vendor.trim(),
    category: receiptForm.category,
    amount: Number(receiptForm.amount || 0),
    paymentMethod: receiptForm.paymentMethod.trim(),
    notes: receiptForm.notes.trim(),
  });
  Object.assign(receiptForm, { date: '', vendor: '', category: 'Hotel', amount: '', paymentMethod: '', notes: '' });
  await saveData();
}

async function removeRow(collection, id) {
  state.data[collection] = state.data[collection].filter((row) => row.id !== id);
  await saveData();
}

function hasMileageForDate(date) {
  return state.data.mileageRows.some((row) => row.date === date);
}

function formatPeriod() {
  const report = state.data.report;
  return `${report.periodFrom || ''} - ${report.periodTo || ''}`;
}

onMounted(fetchData);
</script>

<template>
  <main>
    <header class="app-header">
      <div>
        <p class="eyebrow">Workplace Learning System</p>
        <h1>Expense Statement</h1>
      </div>
      <div class="header-actions">
        <span class="mode-pill">{{ state.storage === 'mongodb' ? 'MongoDB sync' : 'Local fallback' }}</span>
        <span v-if="state.saving" class="mode-pill">Saving...</span>
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
    <p v-if="state.loading" class="loading">Loading...</p>

    <section v-else-if="state.tab === 'statement'" class="statement-grid">
      <form class="report-form" @change="saveData" @submit.prevent="saveData">
        <h2>Report details</h2>
        <input v-model="state.data.report.employeeName" placeholder="Employee name" />
        <input v-model="state.data.report.address" placeholder="Address" />
        <div class="inline-fields">
          <input v-model="state.data.report.employeeId" placeholder="Employee ID" />
          <input v-model="state.data.report.reportNo" placeholder="Report no." />
        </div>
        <div class="inline-fields">
          <input v-model="state.data.report.phone" placeholder="Phone" />
          <input v-model="state.data.report.email" type="email" placeholder="Email" />
        </div>
        <div class="inline-fields">
          <input v-model="state.data.report.periodFrom" type="date" />
          <input v-model="state.data.report.periodTo" type="date" />
          <input v-model="state.data.report.reportDate" type="date" />
        </div>
        <input v-model="state.data.report.engagement" placeholder="Engagement" />
        <input v-model="state.data.report.laborTitle" placeholder="Labor title" />
        <input v-model="state.data.report.laborDescription" placeholder="Labor description" />
        <div class="inline-fields compact">
          <input v-model.number="state.data.report.laborDays" type="number" min="0" step="0.5" placeholder="Days" />
          <input v-model.number="state.data.report.dailyRate" type="number" min="0" step="0.01" placeholder="Daily rate" />
        </div>
        <button type="submit">Save details</button>
      </form>

      <div class="statement-sheet">
        <div class="sheet-topline">
          <span>Making the world a safer place</span>
          <strong>Expense Statement</strong>
        </div>
        <div class="statement-meta">
          <div>
            <strong>{{ state.data.report.employeeName }}</strong>
            <span>{{ state.data.report.address }}</span>
            <span>{{ state.data.report.employeeId }}</span>
            <span>{{ state.data.report.phone }}</span>
            <span>{{ state.data.report.email }}</span>
          </div>
          <dl>
            <dt>EXP. REPORT NO.</dt><dd>{{ state.data.report.reportNo }}</dd>
            <dt>DATE</dt><dd>{{ state.data.report.reportDate }}</dd>
            <dt>EMPLOYEE ID</dt><dd>{{ state.data.report.employeeId }}</dd>
            <dt>PERIOD</dt><dd>{{ formatPeriod() }}</dd>
          </dl>
        </div>
        <div class="engagement-band">{{ state.data.report.engagement }}</div>
        <div class="labor-band">{{ state.data.report.laborTitle }}</div>
        <table class="sheet-table statement-table">
          <thead>
            <tr><th>Date</th><th>Description</th><th># of Days</th><th>Daily Rate</th><th>Total</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ formatPeriod() }}</td>
              <td>{{ state.data.report.laborDescription }}</td>
              <td>{{ state.data.report.laborDays }}</td>
              <td>{{ money.format(Number(state.data.report.dailyRate || 0)) }}</td>
              <td>{{ money.format(laborTotal) }}</td>
            </tr>
            <tr><td></td><td>Expenses (receipts - hotel, meals)</td><td></td><td></td><td>{{ money.format(expenseTotal) }}</td></tr>
            <tr><td></td><td>Mileage ({{ number.format(totalMiles) }} mi)</td><td></td><td></td><td>{{ money.format(mileageTotal) }}</td></tr>
            <tr><td></td><td>Total expenses (receipts + mileage)</td><td></td><td></td><td>{{ money.format(expenseTotal + mileageTotal) }}</td></tr>
          </tbody>
          <tfoot>
            <tr><td colspan="4">TOTAL DUE</td><td>{{ money.format(totalDue) }}</td></tr>
          </tfoot>
        </table>
      </div>
    </section>

    <section v-else-if="state.tab === 'expenses'" class="workbook-view">
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

      <div class="sheet-panel">
        <div class="sheet-title-row"><span>Expense period</span><strong>Expense Report</strong></div>
        <div class="period-row">
          <span>From {{ state.data.report.periodFrom }}</span>
          <span>To {{ state.data.report.periodTo }}</span>
          <span>Report No. {{ state.data.report.reportNo }}</span>
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
              <tr v-for="row in state.data.expenseRows" :key="row.id">
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
      </div>
    </section>

    <section v-else-if="state.tab === 'mileage'" class="workbook-view">
      <form @submit.prevent="addMileage">
        <h2>Add mileage</h2>
        <input v-model="mileageForm.date" type="date" required />
        <input v-model="mileageForm.from" placeholder="From" required />
        <input v-model="mileageForm.to" placeholder="To" required />
        <input v-model="mileageForm.purpose" placeholder="Purpose" />
        <div class="inline-fields compact">
          <input v-model="mileageForm.miles" type="number" min="0" step="0.1" placeholder="Miles" required />
          <input v-model="mileageForm.rate" type="number" min="0" step="0.001" placeholder="Rate" required />
        </div>
        <button type="submit">Add mileage</button>
      </form>

      <div class="sheet-panel mileage-layout">
        <div class="table-scroll">
          <table class="sheet-table">
            <thead><tr><th>Date</th><th>From</th><th>To</th><th>Purpose</th><th>Miles</th><th>$ Per Mile</th><th>Total</th><th></th></tr></thead>
            <tbody>
              <tr v-for="row in state.data.mileageRows" :key="row.id">
                <td>{{ row.date }}</td><td>{{ row.from }}</td><td>{{ row.to }}</td><td>{{ row.purpose }}</td>
                <td>{{ number.format(row.miles) }}</td><td>${{ mileageRate.format(row.rate) }}</td><td>{{ money.format(row.miles * row.rate) }}</td>
                <td><button class="icon" type="button" @click="removeRow('mileageRows', row.id)">Delete</button></td>
              </tr>
            </tbody>
            <tfoot><tr><td colspan="4">TOTALS</td><td>{{ number.format(totalMiles) }}</td><td></td><td>{{ money.format(mileageTotal) }}</td><td></td></tr></tfoot>
          </table>
        </div>
        <aside class="summary-box">
          <h3>Trip Summary</h3>
          <p><span>Total Miles</span><strong>{{ number.format(totalMiles) }}</strong></p>
          <p><span>IRS Rate</span><strong>${{ mileageRate.format(state.data.mileageRows[0]?.rate || 0) }}</strong></p>
          <p><span>Total Reimbursement</span><strong>{{ money.format(mileageTotal) }}</strong></p>
        </aside>
      </div>
    </section>

    <section v-else-if="state.tab === 'worklog'" class="workbook-view">
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
              <tr v-for="(row, index) in state.data.workLogs" :key="row.id">
                <td>{{ index + 1 }}</td><td>{{ row.date }}</td><td>{{ row.clientSite }}</td><td>{{ row.location }}</td><td>{{ row.taskCategory }}</td><td>{{ row.hours }}</td><td>{{ row.summary }}</td><td>{{ row.actions }}</td><td>{{ row.status }}</td><td>{{ hasMileageForDate(row.date) ? 'Yes' : 'Missing' }}</td>
                <td><button class="icon" type="button" @click="removeRow('workLogs', row.id)">Delete</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="summary-strip">
          <span>Total Entries <strong>{{ state.data.workLogs.length }}</strong></span>
          <span>Total Hours <strong>{{ number.format(totalHours) }}</strong></span>
          <span>Avg Hours/Day <strong>{{ number.format(avgHours) }}</strong></span>
        </div>
        <div class="mini-summary">
          <p v-for="(hours, category) in workLogCategoryTotals" :key="category"><span>{{ category }}</span><strong>{{ number.format(hours) }}</strong></p>
        </div>
      </div>
    </section>

    <section v-else-if="state.tab === 'receipts'" class="workbook-view">
      <form @submit.prevent="addReceipt">
        <h2>Add receipt</h2>
        <input v-model="receiptForm.date" type="date" required />
        <input v-model="receiptForm.vendor" placeholder="Vendor / Merchant" required />
        <select v-model="receiptForm.category">
          <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
        </select>
        <input v-model="receiptForm.amount" type="number" min="0" step="0.01" placeholder="Amount" required />
        <input v-model="receiptForm.paymentMethod" placeholder="Payment method" />
        <textarea v-model="receiptForm.notes" placeholder="Notes"></textarea>
        <button type="submit">Add receipt</button>
      </form>

      <div class="sheet-panel">
        <div class="sheet-title-row"><strong>Receipt Tracker</strong></div>
        <div class="table-scroll">
          <table class="sheet-table wide-table">
            <thead><tr><th>#</th><th>Date</th><th>Vendor / Merchant</th><th>Category</th><th>Amount</th><th>Payment Method</th><th>Notes</th><th>Receipt Image</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(row, index) in state.data.receipts" :key="row.id">
                <td>{{ index + 1 }}</td><td>{{ row.date }}</td><td>{{ row.vendor }}</td><td>{{ row.category }}</td><td>{{ money.format(row.amount) }}</td><td>{{ row.paymentMethod }}</td><td>{{ row.notes }}</td><td></td>
                <td><button class="icon" type="button" @click="removeRow('receipts', row.id)">Delete</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="summary-strip">
          <span>Total Receipts <strong>{{ state.data.receipts.length }}</strong></span>
          <span>Total Amount <strong>{{ money.format(receiptTotal) }}</strong></span>
        </div>
        <div class="mini-summary">
          <p v-for="category in categories" :key="category"><span>{{ category }}</span><strong>{{ money.format(receiptCategoryTotals[category]) }}</strong></p>
        </div>
      </div>
    </section>
  </main>
</template>
