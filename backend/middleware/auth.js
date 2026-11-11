const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../models/User');
const GuestSession = require('../models/GuestSession');

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  if (req.query && req.query.token) {
    return String(req.query.token);
  }
  return null;
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

async function resolveGuestFromRequest(req) {
  const guestId = req.headers['x-guest-id'] || (req.body && req.body.guestId);
  const authHeader = req.headers.authorization || '';
  const guestToken =
    req.headers['x-guest-token'] ||
    (authHeader.startsWith('Guest ') ? authHeader.slice(6).trim() : null);

  if (!guestId || !guestToken) return null;

  const session = await GuestSession.findOne({ guestId: String(guestId) }).select('+sessionTokenHash');
  if (!session) return null;
  if (session.status === 'expired' || (session.expiresAt && session.expiresAt < new Date())) {
    return null;
  }

  const incomingHash = hashSessionToken(guestToken);
  if (!safeEqualHex(incomingHash, session.sessionTokenHash)) {
    return null;
  }

  session.lastActiveAt = new Date();
  await session.save();
  return session;
}

async function authenticate(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
    }
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User account is invalid or deactivated.' });
    }
    req.user = user;
    req.actor = { type: 'user', userId: String(user._id) };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session. Please log in again.' });
  }
}

async function authenticateOrGuest(req, res, next) {
  try {
    const token = extractToken(req);
    if (token) {
      const decoded = jwt.verify(token, config.jwtSecret);
      const user = await User.findById(decoded.userId);
      if (user && user.isActive) {
        req.user = user;
        req.actor = { type: 'user', userId: String(user._id) };
        return next();
      }
    }

    const guest = await resolveGuestFromRequest(req);
    if (guest) {
      req.guest = guest;
      req.actor = { type: 'guest', guestId: guest.guestId, deviceId: guest.deviceId };
      return next();
    }

    return res.status(401).json({
      success: false,
      message: 'Please log in or continue as guest to perform this action.'
    });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session.' });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (token) {
      const decoded = jwt.verify(token, config.jwtSecret);
      const user = await User.findById(decoded.userId);
      if (user && user.isActive) {
        req.user = user;
        req.actor = { type: 'user', userId: String(user._id) };
        return next();
      }
    }
    const guest = await resolveGuestFromRequest(req);
    if (guest) {
      req.guest = guest;
      req.actor = { type: 'guest', guestId: guest.guestId, deviceId: guest.deviceId };
    }
  } catch (_) {
    // Ignore invalid optional token
  }
  next();
}

module.exports = {
  authenticate,
  authenticateOrGuest,
  optionalAuth,
  hashSessionToken,
  resolveGuestFromRequest
};
