const { readBody, sendJson } = require('../_lib/http');
const { runClaudeChat } = require('../_lib/ai-review');
const { checkRateLimit } = require('../_lib/rate-limit');
const { requireAuth, projectAccessFilter } = require('../_lib/project-auth');
const { getProjectsCollection, resetMongoCacheIfClosed, toObjectId } = require('../_lib/mongo');

module.exports = async function handler(req, res) {
  try {
    const member = await requireAuth(req, res);
    if (!member) return;

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }

    const rate = checkRateLimit(`ai-chat:${member.id}`, { limit: 30, windowMs: 60 * 1000 });
    if (!rate.allowed) {
      sendJson(res, 429, { error: `Too many AI chat requests. Try again in ${rate.retryAfterSeconds} seconds.` });
      return;
    }

    const body = readBody(req);
    const _id = toObjectId(body.projectId);
    if (!_id) {
      sendJson(res, 400, { error: 'Valid projectId is required.' });
      return;
    }

    const collection = await getProjectsCollection();
    const project = await collection.findOne(projectAccessFilter(member, _id));
    if (!project) {
      sendJson(res, 404, { error: 'Project not found.' });
      return;
    }

    const reply = await runClaudeChat(project, body.messages || []);
    sendJson(res, 200, { reply });
  } catch (error) {
    resetMongoCacheIfClosed(error);
    if (error.code === 'AI_SETUP_REQUIRED') {
      sendJson(res, 503, { error: error.message, setupRequired: true });
      return;
    }
    sendJson(res, 500, { error: error.message || 'Unexpected AI chat error.' });
  }
};
