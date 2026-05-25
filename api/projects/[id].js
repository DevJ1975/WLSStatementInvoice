const { deriveProjectTitle, normalizeProjectData, projectPayload, projectSummary } = require('../_lib/data');
const { getProjectsCollection, getReceiptsBucket, resetMongoCacheIfClosed, toObjectId } = require('../_lib/mongo');
const { readBody, sendJson } = require('../_lib/http');

function projectId(req) {
  const value = req.query?.id;
  return Array.isArray(value) ? value[0] : value;
}

module.exports = async function handler(req, res) {
  try {
    const id = projectId(req);
    const _id = toObjectId(id);
    if (!_id) {
      sendJson(res, 400, { error: 'Invalid project id.' });
      return;
    }

    const collection = await getProjectsCollection();

    if (req.method === 'GET') {
      const project = await collection.findOne({ _id });
      if (!project) {
        sendJson(res, 404, { error: 'Project not found.' });
        return;
      }
      sendJson(res, 200, { project: projectPayload(project), storage: 'mongodb' });
      return;
    }

    if (req.method === 'PUT') {
      const body = readBody(req);
      const existing = await collection.findOne({ _id });
      if (!existing) {
        sendJson(res, 404, { error: 'Project not found.' });
        return;
      }

      const data = normalizeProjectData(body.data || body);
      const update = {
        data,
        title: body.title || deriveProjectTitle({ ...existing, data }),
        updatedAt: new Date(),
      };
      await collection.updateOne({ _id }, { $set: update });
      const project = await collection.findOne({ _id });
      sendJson(res, 200, { project: projectPayload(project), storage: 'mongodb' });
      return;
    }

    if (req.method === 'PATCH') {
      const body = readBody(req);
      const allowedStatus = ['active', 'archived'];
      const $set = { updatedAt: new Date() };
      if (typeof body.title === 'string') {
        $set.title = body.title.trim() || 'Untitled expense project';
      }
      if (allowedStatus.includes(body.status)) {
        $set.status = body.status;
      }

      await collection.updateOne({ _id }, { $set });
      const project = await collection.findOne({ _id });
      if (!project) {
        sendJson(res, 404, { error: 'Project not found.' });
        return;
      }
      sendJson(res, 200, { project: projectSummary(project), storage: 'mongodb' });
      return;
    }

    if (req.method === 'DELETE') {
      const project = await collection.findOne({ _id });
      if (!project) {
        sendJson(res, 404, { error: 'Project not found.' });
        return;
      }

      const receiptFileIds = (project.data?.receipts || [])
        .map((receipt) => toObjectId(receipt.imageFileId))
        .filter(Boolean);
      if (receiptFileIds.length) {
        const bucket = await getReceiptsBucket();
        await Promise.allSettled(receiptFileIds.map((fileId) => bucket.delete(fileId)));
      }

      await collection.deleteOne({ _id });
      sendJson(res, 200, { deleted: true, id, storage: 'mongodb' });
      return;
    }

    res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
    sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    resetMongoCacheIfClosed(error);
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
};
