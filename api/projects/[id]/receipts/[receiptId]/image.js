const { getProjectsCollection, getReceiptsBucket, resetMongoCacheIfClosed, toObjectId } = require('../../../../_lib/mongo');
const { sendJson } = require('../../../../_lib/http');

function routeParam(req, key) {
  const value = req.query?.[key];
  return Array.isArray(value) ? value[0] : value;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }

    const id = routeParam(req, 'id');
    const receiptId = routeParam(req, 'receiptId');
    const _id = toObjectId(id);
    if (!_id || !receiptId) {
      sendJson(res, 400, { error: 'Invalid receipt image request.' });
      return;
    }

    const collection = await getProjectsCollection();
    const project = await collection.findOne({ _id });
    const receipt = project?.data?.receipts?.find((item) => item.id === receiptId);
    const fileId = toObjectId(receipt?.imageFileId);
    if (!receipt || !fileId) {
      sendJson(res, 404, { error: 'Receipt image not found.' });
      return;
    }

    const bucket = await getReceiptsBucket();
    res.setHeader('Content-Type', receipt.imageContentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    bucket.openDownloadStream(fileId).pipe(res);
  } catch (error) {
    resetMongoCacheIfClosed(error);
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
};
