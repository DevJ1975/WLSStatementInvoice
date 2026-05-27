const { deriveProjectTitle, normalizeProjectData, projectPayload, projectSummary } = require('../_lib/data');
const { getProjectsCollection, getReceiptsBucket, resetMongoCacheIfClosed, toObjectId } = require('../_lib/mongo');
const { readBody, sendJson } = require('../_lib/http');
const { memberById, normalizeProjectAssignment, projectAccessFilter, requireAuth, siteId } = require('../_lib/project-auth');
const { isProjectStatus } = require('../_lib/project-status');

function projectId(req) {
  const value = req.query?.id;
  return Array.isArray(value) ? value[0] : value;
}

module.exports = async function handler(req, res) {
  try {
    const member = await requireAuth(req, res);
    if (!member) return;

    const id = projectId(req);
    const _id = toObjectId(id);
    if (!_id) {
      sendJson(res, 400, { error: 'Invalid project id.' });
      return;
    }

    const collection = await getProjectsCollection();

    if (req.method === 'GET') {
      const project = await collection.findOne(projectAccessFilter(member, _id));
      if (!project) {
        sendJson(res, 404, { error: 'Project not found.' });
        return;
      }
      if (!project.siteId) await collection.updateOne({ _id }, { $set: { siteId } });
      sendJson(res, 200, { project: projectPayload(project), storage: 'mongodb' });
      return;
    }

    if (req.method === 'PUT') {
      const body = readBody(req);
      const existing = await collection.findOne(projectAccessFilter(member, _id));
      if (!existing) {
        sendJson(res, 404, { error: 'Project not found.' });
        return;
      }

      const assigned = await normalizeProjectAssignment(member, body, existing);
      const data = normalizeProjectData(assigned.data || body.data || body);
      const update = {
        siteId,
        memberId: assigned.memberId,
        updatedBy: member.id,
        data,
        title: body.title || deriveProjectTitle({ ...existing, data }),
        updatedAt: new Date(),
      };
      const result = await collection.updateOne({ _id }, { $set: update });
      if (!result.acknowledged) {
        sendJson(res, 500, { error: 'MongoDB did not acknowledge the project save.' });
        return;
      }
      const project = await collection.findOne({ _id });
      sendJson(res, 200, { project: projectPayload(project), saved: true, storage: 'mongodb' });
      return;
    }

    if (req.method === 'PATCH') {
      const body = readBody(req);
      const existing = await collection.findOne(projectAccessFilter(member, _id));
      if (!existing) {
        sendJson(res, 404, { error: 'Project not found.' });
        return;
      }
      const $set = { siteId, updatedAt: new Date(), updatedBy: member.id };
      if (typeof body.title === 'string') {
        $set.title = body.title.trim() || 'Untitled expense project';
      }
      if (isProjectStatus(body.status)) {
        $set.status = body.status;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'memberId') && member.role === 'admin') {
        const assignedMember = body.memberId ? await memberById(body.memberId) : null;
        if (body.memberId && !assignedMember) {
          sendJson(res, 400, { error: 'Assigned member was not found.' });
          return;
        }
        $set.memberId = assignedMember ? String(assignedMember._id) : '';
        $set.data = normalizeProjectData(existing.data);
        if (assignedMember) {
          $set.data.report.employeeId = assignedMember.accountNumber || '';
          $set.data.report.employeeName = $set.data.report.employeeName || assignedMember.name || '';
          $set.data.report.phone = $set.data.report.phone || assignedMember.phone || '';
          $set.data.report.email = $set.data.report.email || assignedMember.email || '';
        }
      }

      await collection.updateOne(projectAccessFilter(member, _id), { $set });
      const project = await collection.findOne(projectAccessFilter(member, _id));
      if (!project) {
        sendJson(res, 404, { error: 'Project not found.' });
        return;
      }
      sendJson(res, 200, { project: projectSummary(project), storage: 'mongodb' });
      return;
    }

    if (req.method === 'DELETE') {
      const project = await collection.findOne(projectAccessFilter(member, _id));
      if (!project) {
        sendJson(res, 404, { error: 'Project not found.' });
        return;
      }

      const receiptFileIds = (project.data?.receipts || [])
        .map((receipt) => toObjectId(receipt.imageFileId))
        .filter(Boolean);
      if (receiptFileIds.length) {
        const bucket = await getReceiptsBucket();
        await Promise.allSettled(receiptFileIds.map((fileId) => bucket.delete(fileId)));
      }

      await collection.deleteOne(projectAccessFilter(member, _id));
      sendJson(res, 200, { deleted: true, id, storage: 'mongodb' });
      return;
    }

    res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
    sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    resetMongoCacheIfClosed(error);
    sendJson(res, 500, { error: error.message || 'Unexpected server error.' });
  }
};
