const { GridFSBucket, MongoClient, ObjectId, ServerApiVersion } = require('mongodb');

let cachedClient;
let cachedClientPromise;

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

async function getDb() {
  const client = await getClient();
  return client.db(process.env.MONGODB_DB || 'wls_statement_invoice');
}

async function getProjectsCollection() {
  const db = await getDb();
  return db.collection(process.env.MONGODB_PROJECTS_COLLECTION || 'projects');
}

async function getReceiptsBucket() {
  const db = await getDb();
  return new GridFSBucket(db, {
    bucketName: process.env.MONGODB_RECEIPTS_BUCKET || 'receipt_images',
  });
}

function toObjectId(id) {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  return new ObjectId(id);
}

function resetMongoCacheIfClosed(error) {
  if (/topology is closed/i.test(error.message || '')) {
    cachedClient = undefined;
    cachedClientPromise = undefined;
  }
}

module.exports = {
  getProjectsCollection,
  getReceiptsBucket,
  resetMongoCacheIfClosed,
  toObjectId,
};
