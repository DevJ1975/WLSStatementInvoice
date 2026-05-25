const { hashPin, requireAdmin, sanitizeMember } = require('../_lib/auth');
const { readBody, sendJson } = require('../_lib/http');
const { getMembersCollection, resetMongoCacheIfClosed, toObjectId } = require('../_lib/mongo');

function memberId(req) {
  const value = req.query?.id;
  return Array.isArray(value) ? value[0] : value;
}

module.exports = async function handler(req, res) {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const _id = toObjectId(memberId(req));
    if (!_id) {
      sendJson(res, 400, { error: 'Invalid member id.' });
      return;
    }

    const collection = await getMembersCollection();
    if (req.method === 'PATCH') {
      const body = readBody(req);
      const $set = { updatedAt: new Date() };
      if (typeof body.name === 'string') $set.name = body.name.trim() || 'Member';
      if (typeof body.email === 'string') $set.email = body.email.trim();
      if (typeof body.phone === 'string') $set.phone = body.phone.trim();
      if (['admin', 'member'].includes(body.role)) $set.role = body.role;
      if (['active', 'disabled'].includes(body.status)) $set.status = body.status;
      if (body.pin) Object.assign($set, await hashPin(body.pin));

      await collection.updateOne({ _id, siteId: 'default' }, { $set });
      const member = await collection.findOne({ _id, siteId: 'default' });
      if (!member) {
        sendJson(res, 404, { error: 'Member not found.' });
        return;
      }
      sendJson(res, 200, { member: sanitizeMember(member) });
      return;
    }

    if (req.method === 'DELETE') {
      const result = await collection.updateOne(
        { _id, siteId: 'default' },
        { $set: { status: 'disabled', updatedAt: new Date() } }
      );
      if (!result.matchedCount) {
        sendJson(res, 404, { error: 'Member not found.' });
        return;
      }
      sendJson(res, 200, { disabled: true, id: memberId(req) });
      return;
    }

    res.setHeader('Allow', 'PATCH, DELETE');
    sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    resetMongoCacheIfClosed(error);
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
};
