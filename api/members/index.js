const { createMemberRecord, requireAdmin, sanitizeMember } = require('../_lib/auth');
const { readBody, sendJson } = require('../_lib/http');
const { getMembersCollection, resetMongoCacheIfClosed } = require('../_lib/mongo');

module.exports = async function handler(req, res) {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const collection = await getMembersCollection();
    if (req.method === 'GET') {
      const members = await collection.find({ siteId: 'default' }).sort({ role: 1, name: 1, accountNumber: 1 }).toArray();
      sendJson(res, 200, { members: members.map(sanitizeMember) });
      return;
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      const member = await createMemberRecord({
        name: body.name,
        email: body.email,
        phone: body.phone,
        role: body.role,
        status: body.status || 'active',
        pin: body.pin,
      });
      sendJson(res, 201, { member });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    resetMongoCacheIfClosed(error);
    if (error.code === 11000) {
      sendJson(res, 409, { error: 'That account number is already in use.' });
      return;
    }
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
};
