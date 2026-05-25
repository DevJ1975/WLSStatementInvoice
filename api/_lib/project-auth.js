const { normalizeProjectData } = require('./data');
const { projectAccessFilter, projectListFilter, requireAuth, siteId } = require('./auth');
const { getMembersCollection, toObjectId } = require('./mongo');

async function memberById(memberId) {
  const _id = toObjectId(memberId);
  if (!_id) return null;
  const collection = await getMembersCollection();
  return collection.findOne({ _id, siteId });
}

function applyMemberToProjectData(data, member) {
  const normalized = normalizeProjectData(data);
  if (!member) return normalized;
  normalized.report.employeeId = member.accountNumber || normalized.report.employeeId;
  normalized.report.employeeName = normalized.report.employeeName || member.name || '';
  normalized.report.phone = normalized.report.phone || member.phone || '';
  normalized.report.email = normalized.report.email || member.email || '';
  return normalized;
}

async function normalizeProjectAssignment(member, body = {}, existingProject = null) {
  if (member.role === 'member') {
    const owner = {
      _id: member.id,
      accountNumber: member.accountNumber,
      name: member.name,
      phone: member.phone,
      email: member.email,
    };
    return {
      memberId: member.id,
      data: applyMemberToProjectData(body.data || existingProject?.data, owner),
    };
  }

  const requestedMemberId =
    typeof body.memberId === 'string'
      ? body.memberId
      : typeof existingProject?.memberId === 'string'
        ? existingProject.memberId
        : '';
  const owner = requestedMemberId ? await memberById(requestedMemberId) : null;
  return {
    memberId: owner ? String(owner._id) : requestedMemberId || '',
    data: applyMemberToProjectData(body.data || existingProject?.data, owner),
  };
}

function canAssignMember(admin, memberId) {
  return admin.role === 'admin' && (memberId === '' || Boolean(toObjectId(memberId)));
}

module.exports = {
  applyMemberToProjectData,
  canAssignMember,
  memberById,
  normalizeProjectAssignment,
  projectAccessFilter,
  projectListFilter,
  requireAuth,
  siteId,
};
