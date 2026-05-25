const { blankProjectData, projectSummary } = require('../_lib/data');
const { normalizeProjectAssignment, projectListFilter, requireAuth, siteId } = require('../_lib/project-auth');
const { getProjectsCollection, resetMongoCacheIfClosed } = require('../_lib/mongo');
const { readBody, sendJson } = require('../_lib/http');

module.exports = async function handler(req, res) {
  try {
    const member = await requireAuth(req, res);
    if (!member) return;

    const collection = await getProjectsCollection();

    if (req.method === 'GET') {
      await collection.updateMany({ siteId: { $exists: false } }, { $set: { siteId } });
      const projects = await collection.find(projectListFilter(member)).sort({ updatedAt: -1 }).toArray();
      sendJson(res, 200, { projects: projects.map(projectSummary), storage: 'mongodb' });
      return;
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      const now = new Date();
      const assigned = await normalizeProjectAssignment(member, { data: blankProjectData(), memberId: body.memberId });
      const doc = {
        siteId,
        memberId: assigned.memberId,
        createdBy: member.id,
        updatedBy: member.id,
        title: body.title || 'Untitled expense project',
        status: 'active',
        data: assigned.data,
        createdAt: now,
        updatedAt: now,
      };
      const result = await collection.insertOne(doc);
      sendJson(res, 201, {
        project: projectSummary({ ...doc, _id: result.insertedId }),
        storage: 'mongodb',
      });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    resetMongoCacheIfClosed(error);
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
};
