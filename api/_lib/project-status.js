const projectStatuses = ['active', 'archived', 'deleted'];

function isProjectStatus(value) {
  return projectStatuses.includes(value);
}

module.exports = { isProjectStatus, projectStatuses };
