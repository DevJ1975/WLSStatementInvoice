const { MongoClient, ServerApiVersion } = require('mongodb');

const workspaceId = 'default';
let cachedClient;
let cachedClientPromise;

function blankReportData() {
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

function normalizeData(data) {
  const blank = blankReportData();
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

async function getClient() {
  if (cachedClient) {
    return cachedClient;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error('Missing MONGODB_URI environment variable.');
  }

  if (!cachedClientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      serverSelectionTimeoutMS: 10000,
    });

    cachedClientPromise = client
      .connect()
      .then(() => {
        cachedClient = client;
        return client;
      })
      .catch((error) => {
        cachedClient = undefined;
        cachedClientPromise = undefined;
        throw error;
      });
  }

  return cachedClientPromise;
}

async function getCollection() {
  const client = await getClient();
  const dbName = process.env.MONGODB_DB || 'wls_statement_invoice';
  const collectionName = process.env.MONGODB_COLLECTION || 'reports';
  return client.db(dbName).collection(collectionName);
}

function sendJson(res, statusCode, payload) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.status(statusCode).json(payload);
}

module.exports = async function handler(req, res) {
  try {
    const collection = await getCollection();

    if (req.method === 'GET') {
      const existing = await collection.findOne({ workspaceId });

      if (existing) {
        sendJson(res, 200, { data: normalizeData(existing.data), storage: 'mongodb' });
        return;
      }

      const data = blankReportData();
      await collection.insertOne({
        workspaceId,
        data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      sendJson(res, 200, { data, storage: 'mongodb' });
      return;
    }

    if (req.method === 'PUT') {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const data = normalizeData(payload.data || payload);

      await collection.updateOne(
        { workspaceId },
        {
          $set: { data, updatedAt: new Date() },
          $setOnInsert: { workspaceId, createdAt: new Date() },
        },
        { upsert: true }
      );

      sendJson(res, 200, { data, storage: 'mongodb' });
      return;
    }

    res.setHeader('Allow', 'GET, PUT');
    sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    if (/topology is closed/i.test(error.message || '')) {
      cachedClient = undefined;
      cachedClientPromise = undefined;
    }
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
};
