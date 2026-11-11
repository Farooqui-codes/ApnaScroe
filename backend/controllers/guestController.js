const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const GuestSession = require('../models/GuestSession');
const GuestMigrationJob = require('../models/GuestMigrationJob');
const Match = require('../models/Match');
const Team = require('../models/Team');
const Player = require('../models/Player');
const ScoringRule = require('../models/ScoringRule');
const { hashSessionToken, resolveGuestFromRequest } = require('../middleware/auth');
const migrationService = require('../services/migrationService');
const { logAudit } = require('../utils/logger');

async function createGuestSession(req, res, next) {
  try {
    const deviceId = (req.body && req.body.deviceId) ? String(req.body.deviceId).trim() : ('dev_' + uuidv4().slice(0, 12));
    const requestedGuestId = req.body && req.body.guestId ? String(req.body.guestId).trim() : null;

    const guestId = requestedGuestId || ('gst_' + uuidv4().replace(/-/g, '').slice(0, 16));
    const existing = await GuestSession.findOne({ guestId });
    if (existing) {
      // Never issue a fresh token for an existing guestId without a matching device/token — create a fresh guestId instead
      const freshGuestId = 'gst_' + uuidv4().replace(/-/g, '').slice(0, 16);
      const guestToken = crypto.randomBytes(32).toString('hex');
      const session = await GuestSession.create({
        guestId: freshGuestId,
        deviceId,
        sessionTokenHash: hashSessionToken(guestToken),
        status: 'active',
        migrationStatus: 'pending',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });
      return res.status(201).json({
        success: true,
        guestId: session.guestId,
        deviceId: session.deviceId,
        guestToken,
        expiresAt: session.expiresAt,
        migrationStatus: session.migrationStatus
      });
    }

    const guestToken = crypto.randomBytes(32).toString('hex');
    const session = await GuestSession.create({
      guestId,
      deviceId,
      sessionTokenHash: hashSessionToken(guestToken),
      status: 'active',
      migrationStatus: 'pending',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    await logAudit({
      req: { ip: req.ip },
      action: 'GUEST_SESSION_CREATED',
      entityType: 'GuestSession',
      entityId: session._id,
      details: { guestId: session.guestId, deviceId: session.deviceId }
    });

    res.status(201).json({
      success: true,
      guestId: session.guestId,
      deviceId: session.deviceId,
      guestToken,
      expiresAt: session.expiresAt,
      migrationStatus: session.migrationStatus
    });
  } catch (err) {
    next(err);
  }
}

async function getGuestSession(req, res, next) {
  try {
    const guest = await resolveGuestFromRequest(req);
    if (!guest) {
      return res.status(401).json({ success: false, message: 'Invalid or expired guest session.' });
    }

    const [matches, teams, players, rules] = await Promise.all([
      Match.countDocuments({ ownerType: 'guest', guestId: guest.guestId }),
      Team.countDocuments({ ownerType: 'guest', guestId: guest.guestId }),
      Player.countDocuments({ ownerType: 'guest', guestId: guest.guestId }),
      ScoringRule.countDocuments({ ownerType: 'guest', guestId: guest.guestId })
    ]);

    res.json({
      success: true,
      session: {
        guestId: guest.guestId,
        deviceId: guest.deviceId,
        status: guest.status,
        migrationStatus: guest.migrationStatus,
        expiresAt: guest.expiresAt,
        lastActiveAt: guest.lastActiveAt
      },
      counts: { matches, teams, players, customRules: rules }
    });
  } catch (err) {
    next(err);
  }
}

async function migrateGuestData(req, res, next) {
  try {
    const { guestId, guestToken, deviceId, migrationId, localData } = req.body;
    if (!guestId) {
      return res.status(400).json({ success: false, message: 'guestId is required for migration.' });
    }

    // If a GuestSession already exists on the backend for this guestId, require & verify guestToken!
    const existingSession = await GuestSession.findOne({ guestId }).select('+sessionTokenHash');
    if (existingSession) {
      if (!guestToken) {
        return res.status(401).json({
          success: false,
          message: 'Guest session token is required to authorize migration of this guest session.'
        });
      }
      const incomingHash = hashSessionToken(guestToken);
      const valid =
        incomingHash.length === existingSession.sessionTokenHash.length &&
        crypto.timingSafeEqual(
          Buffer.from(incomingHash, 'utf8'),
          Buffer.from(existingSession.sessionTokenHash, 'utf8')
        );
      if (!valid) {
        return res.status(403).json({
          success: false,
          message: 'Guest session token verification failed. Cannot migrate unauthorized guest data.'
        });
      }
    }

    const result = await migrationService.migrateGuestToUser({
      targetUser: req.user,
      guestId,
      deviceId: deviceId || (existingSession && existingSession.deviceId) || '',
      migrationId,
      localData: localData || {}
    });

    res.json(result);
  } catch (err) {
    if (err.migrationId) {
      return res.status(err.statusCode || 500).json({
        success: false,
        verified: false,
        migrationId: err.migrationId,
        migrationStatus: err.migrationStatus,
        message: err.message
      });
    }
    next(err);
  }
}

async function getMigrationJobs(req, res, next) {
  try {
    const jobs = await GuestMigrationJob.find({ targetUserId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.json({ success: true, jobs });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createGuestSession,
  getGuestSession,
  migrateGuestData,
  getMigrationJobs
};
