const { normalizeMemberPreferences } = require('../_lib/preferences');
const { requireAuth } = require('../_lib/auth');
const { readBody, sendJson } = require('../_lib/http');
const { getMembersCollection, resetMongoCacheIfClosed, toObjectId } = require('../_lib/mongo');

module.exports = async function handler(req, res) {
  try {
    const member = await requireAuth(req, res);
    if (!member) return;

    const memberId = toObjectId(member.id);
    if (!memberId) {
      sendJson(res, 400, { error: 'Invalid member id.' });
      return;
    }

    const collection = await getMembersCollection();

    if (req.method === 'GET') {
      const existing = await collection.findOne({ _id: memberId, siteId: 'default' }, { projection: { preferences: 1 } });
      sendJson(res, 200, { preferences: normalizeMemberPreferences(existing?.preferences) });
      return;
    }

    if (req.method === 'PATCH') {
      const body = readBody(req);
      const preferences = normalizeMemberPreferences(body.preferences || body);
      await collection.updateOne(
        { _id: memberId, siteId: 'default' },
        { $set: { preferences, updatedAt: new Date() } }
      );
      sendJson(res, 200, { preferences, saved: true });
      return;
    }

    res.setHeader('Allow', 'GET, PATCH');
    sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    resetMongoCacheIfClosed(error);
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
};
