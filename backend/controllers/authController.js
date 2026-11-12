const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../models/User');
const Player = require('../models/Player');
const Match = require('../models/Match');
const Team = require('../models/Team');
const { storeUploadedImage } = require('../services/imageStorageService');
const { logAudit } = require('../utils/logger');

function signToken(user) {
  return jwt.sign(
    { userId: user._id, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

async function register(req, res, next) {
  try {
    const { name, email, password, phone, village, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const totalUsers = await User.countDocuments();
    const allowedSelfRoles = ['organizer', 'team_manager', 'scorer', 'viewer'];
    let assignedRole = allowedSelfRoles.includes(role) ? role : 'scorer';
    if (totalUsers === 0 && role === 'super_admin') {
      assignedRole = 'super_admin';
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await User.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      phone: phone ? String(phone).trim() : '',
      village: village ? String(village).trim() : '',
      passwordHash,
      role: assignedRole
    });

    await logAudit({
      req: { user, ip: req.ip },
      action: 'USER_REGISTERED',
      entityType: 'User',
      entityId: user._id,
      details: { role: assignedRole }
    });

    const token = signToken(user);
    res.status(201).json({
      success: true,
      token,
      user: user.toSafeJSON()
    });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+passwordHash');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated. Contact administrator.' });
    }

    const valid = await bcrypt.compare(String(password), user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = signToken(user);
    res.json({
      success: true,
      token,
      user: user.toSafeJSON()
    });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  res.json({ success: true, user: req.user.toSafeJSON() });
}

async function checkUsername(req, res, next) {
  try {
    const raw = String(req.query.username || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(raw)) {
      return res.json({ success: true, available: false, reason: 'Use 3–24 lowercase letters, numbers, or underscores.' });
    }
    const existing = await User.findOne({ username: raw, _id: { $ne: req.user._id } }).select('_id').lean();
    res.json({ success: true, available: !existing });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const {
      name, phone, village, avatarUrl, displayName, username,
      district, state, dob, age, bio, cricketProfile, organizerProfile, privacy
    } = req.body;
    const user = req.user;

    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName) return res.status(400).json({ success: false, message: 'Full name cannot be empty.' });
      user.name = cleanName.slice(0, 80);
    }
    if (displayName !== undefined) user.displayName = String(displayName).trim().slice(0, 50);
    if (username !== undefined) {
      const cleanUser = String(username).trim().toLowerCase();
      if (cleanUser === '') {
        user.username = undefined;
      } else {
        if (!/^[a-z0-9_]{3,24}$/.test(cleanUser)) {
          return res.status(400).json({ success: false, message: 'Username must be 3–24 characters (letters, numbers, underscore).' });
        }
        const taken = await User.findOne({ username: cleanUser, _id: { $ne: user._id } }).select('_id').lean();
        if (taken) return res.status(409).json({ success: false, message: 'Username is already taken.' });
        user.username = cleanUser;
      }
    }
    if (phone !== undefined) {
      const cleanPhone = String(phone).replace(/[^\d+\s-]/g, '').trim();
      if (cleanPhone && cleanPhone.replace(/\D/g, '').length < 8) {
        return res.status(400).json({ success: false, message: 'Please enter a valid phone number.' });
      }
      user.phone = cleanPhone;
    }
    if (village !== undefined) user.village = String(village).trim().slice(0, 80);
    if (district !== undefined) user.district = String(district).trim().slice(0, 60);
    if (state !== undefined) user.state = String(state).trim().slice(0, 60);
    if (dob !== undefined) user.dob = dob ? new Date(dob) : null;
    if (age !== undefined) user.age = (age === '' || age === null) ? null : Math.max(6, Math.min(100, Number(age)));
    if (bio !== undefined) user.bio = String(bio).trim().slice(0, 150);
    if (avatarUrl !== undefined) user.avatarUrl = String(avatarUrl).trim();

    if (cricketProfile && typeof cricketProfile === 'object') {
      user.cricketProfile = Object.assign({}, user.cricketProfile || {}, {
        playingRole: cricketProfile.playingRole ?? user.cricketProfile?.playingRole ?? '',
        battingStyle: cricketProfile.battingStyle ?? user.cricketProfile?.battingStyle ?? '',
        bowlingStyle: cricketProfile.bowlingStyle ?? user.cricketProfile?.bowlingStyle ?? '',
        jerseyNumber: (cricketProfile.jerseyNumber === '' || cricketProfile.jerseyNumber === null)
          ? null
          : (cricketProfile.jerseyNumber !== undefined ? Number(cricketProfile.jerseyNumber) : user.cricketProfile?.jerseyNumber),
        favouritePlayer: cricketProfile.favouritePlayer !== undefined ? String(cricketProfile.favouritePlayer).trim().slice(0, 60) : (user.cricketProfile?.favouritePlayer || ''),
        clubName: cricketProfile.clubName !== undefined ? String(cricketProfile.clubName).trim().slice(0, 80) : (user.cricketProfile?.clubName || '')
      });
    }

    if (organizerProfile && typeof organizerProfile === 'object') {
      user.organizerProfile = Object.assign({}, user.organizerProfile || {}, {
        orgName: organizerProfile.orgName !== undefined ? String(organizerProfile.orgName).trim().slice(0, 100) : (user.organizerProfile?.orgName || '')
      });
    }

    if (privacy && typeof privacy === 'object') {
      user.preferences = user.preferences || {};
      user.preferences.privacy = Object.assign({}, user.preferences.privacy || {}, {
        showProfilePublicly: privacy.showProfilePublicly !== undefined ? Boolean(privacy.showProfilePublicly) : (user.preferences.privacy?.showProfilePublicly ?? true),
        showPhone: privacy.showPhone !== undefined ? Boolean(privacy.showPhone) : (user.preferences.privacy?.showPhone ?? false),
        showAge: privacy.showAge !== undefined ? Boolean(privacy.showAge) : (user.preferences.privacy?.showAge ?? true),
        showLocation: privacy.showLocation !== undefined ? Boolean(privacy.showLocation) : (user.preferences.privacy?.showLocation ?? true)
      });
    }

    await user.save();

    if (user.linkedPlayerId) {
      await Player.findByIdAndUpdate(user.linkedPlayerId, {
        name: user.displayName || user.name,
        photoUrl: user.avatarUrl || '',
        village: user.village || 'Local Ground'
      }).catch(() => {});
    }

    res.json({ success: true, user: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || String(newPassword).length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Current password and a new password (min 6 characters) are required.'
      });
    }
    const user = await User.findById(req.user._id).select('+passwordHash');
    const ok = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!ok) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }
    user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    await user.save();

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
}

async function uploadAvatar(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file uploaded.' });
    }
    const url = await storeUploadedImage(req.file, 'apnascore/avatars');
    req.user.avatarUrl = url;
    await req.user.save();
    if (req.user.linkedPlayerId) {
      await Player.findByIdAndUpdate(req.user.linkedPlayerId, { photoUrl: url }).catch(() => {});
    }
    res.json({ success: true, avatarUrl: url, user: req.user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
}

async function removeAvatar(req, res, next) {
  try {
    req.user.avatarUrl = '';
    await req.user.save();
    if (req.user.linkedPlayerId) {
      await Player.findByIdAndUpdate(req.user.linkedPlayerId, { photoUrl: '' }).catch(() => {});
    }
    res.json({ success: true, user: req.user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
}

async function uploadOrgLogo(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No logo file uploaded.' });
    const url = await storeUploadedImage(req.file, 'apnascore/org-logos');
    req.user.organizerProfile = Object.assign({}, req.user.organizerProfile || {}, { orgLogoUrl: url });
    await req.user.save();
    res.json({ success: true, orgLogoUrl: url, user: req.user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
}

async function getProfileStats(req, res, next) {
  try {
    const user = req.user;
    const [linkedPlayer, myPlayers, recentMatches] = await Promise.all([
      user.linkedPlayerId ? Player.findById(user.linkedPlayerId).lean() : null,
      Player.find({ userId: user._id }).select('name village role stats photoUrl').sort({ createdAt: -1 }).limit(50).lean(),
      Match.find({ $or: [{ userId: user._id }, { scorerId: user._id }] })
        .select('title status matchDate oversPerInnings result')
        .sort({ matchDate: -1 })
        .limit(8)
        .lean()
    ]);

    res.json({ success: true, linkedPlayer, myPlayers, recentMatches });
  } catch (err) {
    next(err);
  }
}

async function linkPlayer(req, res, next) {
  try {
    const { playerId } = req.body || {};
    if (!playerId) {
      req.user.linkedPlayerId = null;
      await req.user.save();
      return res.json({ success: true, user: req.user.toSafeJSON(), linkedPlayer: null });
    }
    const player = await Player.findById(playerId);
    if (!player) return res.status(404).json({ success: false, message: 'Player not found.' });
    if (req.user.role !== 'super_admin' && String(player.userId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You can only link a player profile you created.' });
    }

    req.user.linkedPlayerId = player._id;
    await req.user.save();
    player.linkedUserId = req.user._id;
    if (req.user.avatarUrl) player.photoUrl = req.user.avatarUrl;
    await player.save();

    res.json({ success: true, user: req.user.toSafeJSON(), linkedPlayer: player });
  } catch (err) {
    next(err);
  }
}

async function exportMyData(req, res, next) {
  try {
    const Tournament = require('../models/Tournament');
    const Delivery = require('../models/Delivery');
    const [matches, teams, players, tournaments] = await Promise.all([
      Match.find({ userId: req.user._id }).lean(),
      Team.find({ userId: req.user._id }).lean(),
      Player.find({ userId: req.user._id }).lean(),
      Tournament.find({ organizerId: req.user._id }).lean()
    ]);
    const matchIds = matches.map((m) => m._id);
    const deliveries = matchIds.length
      ? await Delivery.find({ matchId: { $in: matchIds } }).sort({ matchId: 1, inningsNumber: 1, sequence: 1 }).lean()
      : [];
    res.setHeader('Content-Disposition', 'attachment; filename="apnascore_my_data.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      profile: req.user.toSafeJSON(),
      matches,
      deliveries,
      teams,
      players,
      tournaments
    });
  } catch (err) {
    next(err);
  }
}

async function deleteMyAccount(req, res, next) {
  try {
    const { confirmText } = req.body || {};
    if (confirmText !== 'DELETE') {
      return res.status(400).json({ success: false, message: 'Type DELETE to confirm account deletion.' });
    }
    await User.findByIdAndDelete(req.user._id);
    await logAudit({ req, action: 'USER_DELETED_SELF', entityType: 'User', entityId: req.user._id });
    res.json({ success: true, message: 'Your account has been permanently deleted.' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  me,
  checkUsername,
  updateProfile,
  changePassword,
  uploadAvatar,
  removeAvatar,
  uploadOrgLogo,
  getProfileStats,
  linkPlayer,
  exportMyData,
  deleteMyAccount
};
