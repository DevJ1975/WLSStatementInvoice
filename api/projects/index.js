const { blankProjectData, projectSummary } = require('../_lib/data');
const { getProjectsCollection, resetMongoCacheIfClosed } = require('../_lib/mongo');
const { readBody, sendJson } = require('../_lib/http');

module.exports = async function handler(req, res) {
  try {
    const collection = await getProjectsCollection();

    if (req.method === 'GET') {
      const projects = await collection.find({}).sort({ updatedAt: -1 }).toArray();
      sendJson(res, 200, { projects: projects.map(projectSummary), storage: 'mongodb' });
      return;
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      const now = new Date();
      const doc = {
        title: body.title || 'Untitled expense project',
        status: 'active',
        data: blankProjectData(),
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
