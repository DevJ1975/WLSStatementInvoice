const Busboy = require('busboy');
const { randomUUID } = require('node:crypto');
const { normalizeProjectData, projectPayload } = require('../../_lib/data');
const { getProjectsCollection, getReceiptsBucket, resetMongoCacheIfClosed, toObjectId } = require('../../_lib/mongo');
const { sendJson } = require('../../_lib/http');
const { projectAccessFilter, requireAuth, siteId } = require('../../_lib/project-auth');

const receiptUploadLimitBytes = 3 * 1024 * 1024;

function projectId(req) {
  const value = req.query?.id;
  return Array.isArray(value) ? value[0] : value;
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const chunks = [];
    let fileInfo = null;

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: receiptUploadLimitBytes,
      },
    });

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (name, file, info) => {
      fileInfo = info;
      file.on('data', (chunk) => chunks.push(chunk));
      file.on('limit', () => reject(new Error('Receipt image is larger than 3MB after compression.')));
    });

    busboy.on('error', reject);
    busboy.on('finish', () => {
      resolve({
        fields,
        file: chunks.length
          ? {
              buffer: Buffer.concat(chunks),
              filename: fileInfo?.filename || 'receipt.jpg',
              mimeType: fileInfo?.mimeType || 'application/octet-stream',
            }
          : null,
      });
    });

    req.pipe(busboy);
  });
}

async function handler(req, res) {
  try {
    const member = await requireAuth(req, res);
    if (!member) return;

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }

    const id = projectId(req);
    const _id = toObjectId(id);
    if (!_id) {
      sendJson(res, 400, { error: 'Invalid project id.' });
      return;
    }

    const { fields, file } = await parseMultipart(req);
    if (!file) {
      sendJson(res, 400, { error: 'Receipt image is required.' });
      return;
    }

    const metadata = JSON.parse(fields.metadata || '{}');
    const collection = await getProjectsCollection();
    const project = await collection.findOne(projectAccessFilter(member, _id));
    if (!project) {
      sendJson(res, 404, { error: 'Project not found.' });
      return;
    }

    const receiptId = randomUUID();
    const expenseId = randomUUID();
    const bucket = await getReceiptsBucket();
    const uploadStream = bucket.openUploadStream(file.filename, {
      contentType: file.mimeType,
      metadata: {
        projectId: id,
        receiptId,
      },
    });

    await new Promise((resolve, reject) => {
      uploadStream.on('error', reject);
      uploadStream.on('finish', resolve);
      uploadStream.end(file.buffer);
    });

    const receipt = {
      id: receiptId,
      expenseId,
      date: metadata.date || '',
      vendor: metadata.vendor || '',
      category: metadata.category || 'Misc.',
      amount: Number(metadata.amount || 0),
      paymentMethod: metadata.paymentMethod || '',
      notes: metadata.notes || '',
      ocrText: metadata.ocrText || '',
      imageFileId: String(uploadStream.id),
      imageFileName: file.filename,
      imageContentType: file.mimeType,
      originalImageBytes: Number(metadata.originalImageBytes || 0),
      storedImageBytes: Number(metadata.storedImageBytes || file.buffer.length),
      createdAt: new Date().toISOString(),
    };

    const expense = {
      id: expenseId,
      date: receipt.date,
      vendor: receipt.vendor,
      description: receipt.notes || 'Receipt expense',
      category: receipt.category,
      amount: receipt.amount,
      receiptId,
    };

    const data = normalizeProjectData(project.data);
    data.receipts.push(receipt);
    data.expenseRows.push(expense);

    await collection.updateOne(
      projectAccessFilter(member, _id),
      {
        $set: {
          siteId,
          data,
          updatedBy: member.id,
          updatedAt: new Date(),
        },
      }
    );

    const updated = await collection.findOne(projectAccessFilter(member, _id));
    sendJson(res, 201, { project: projectPayload(updated), receipt, expense, storage: 'mongodb' });
  } catch (error) {
    resetMongoCacheIfClosed(error);
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
}

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
