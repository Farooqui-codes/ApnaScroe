const AuditLog = require('../models/AuditLog');

async function logAudit({ req, action, entityType, entityId, details }) {
  try {
    await AuditLog.create({
      actorId: req && req.user ? req.user._id : null,
      actorRole: req && req.user ? req.user.role : 'system',
      action,
      entityType,
      entityId: entityId ? String(entityId) : '',
      details: details || {},
      ipAddress: req ? req.ip || '' : ''
    });
  } catch (err) {
    console.warn('[AuditLog] Failed to persist audit log:', err.message);
  }
}

module.exports = { logAudit };
