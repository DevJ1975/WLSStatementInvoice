const { currentMember } = require('../_lib/auth');
const { sendJson } = require('../_lib/http');
const { resetMongoCacheIfClosed } = require('../_lib/mongo');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }

    const member = await currentMember(req);
    sendJson(res, 200, { member, authenticated: Boolean(member) });
  } catch (error) {
    resetMongoCacheIfClosed(error);
    if (error.code === 'AUTH_SETUP_REQUIRED') {
      sendJson(res, 200, { member: null, authenticated: false, setupRequired: true });
      return;
    }
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
};
