const { logout } = require('../_lib/auth');
const { sendJson } = require('../_lib/http');
const { resetMongoCacheIfClosed } = require('../_lib/mongo');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }
    await logout(req, res);
    sendJson(res, 200, { authenticated: false });
  } catch (error) {
    resetMongoCacheIfClosed(error);
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
};
