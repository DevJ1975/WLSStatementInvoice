const { createMemberRecord, createSession, sanitizeMember } = require('../_lib/auth');
const { readBody, sendJson } = require('../_lib/http');
const { getMembersCollection, resetMongoCacheIfClosed } = require('../_lib/mongo');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }

    const members = await getMembersCollection();
    const existing = await members.countDocuments({ siteId: 'default' });
    if (existing > 0) {
      sendJson(res, 409, { error: 'Admin setup is already complete.' });
      return;
    }

    const body = readBody(req);
    const member = await createMemberRecord({
      name: body.name || 'Administrator',
      email: body.email || '',
      phone: body.phone || '',
      accountNumber: body.accountNumber,
      pin: body.pin,
      role: 'admin',
      status: 'active',
    });
    const expiresAt = await createSession(req, res, member);
    sendJson(res, 201, { member: sanitizeMember(member), expiresAt, authenticated: true });
  } catch (error) {
    resetMongoCacheIfClosed(error);
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
};
