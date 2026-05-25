const { assertAuthReady, createSession, sanitizeMember, siteId, verifyPin } = require('../_lib/auth');
const { readBody, sendJson } = require('../_lib/http');
const { getMembersCollection, resetMongoCacheIfClosed } = require('../_lib/mongo');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }

    await assertAuthReady();
    const body = readBody(req);
    const accountNumber = String(body.accountNumber || '').trim();
    const pin = String(body.pin || '').trim();
    if (!/^\d{4}$/.test(accountNumber) || !pin) {
      sendJson(res, 400, { error: 'Enter your 4-digit account number and PIN.' });
      return;
    }

    const members = await getMembersCollection();
    const member = await members.findOne({ siteId, accountNumber, status: 'active' });
    if (!member || !(await verifyPin(pin, member))) {
      sendJson(res, 401, { error: 'Invalid account number or PIN.' });
      return;
    }

    const expiresAt = await createSession(req, res, member);
    sendJson(res, 200, { member: sanitizeMember(member), expiresAt, authenticated: true });
  } catch (error) {
    resetMongoCacheIfClosed(error);
    if (error.code === 'AUTH_SETUP_REQUIRED') {
      sendJson(res, 503, { error: error.message, setupRequired: true });
      return;
    }
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
};
