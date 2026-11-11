const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../models/User');
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

async function updateProfile(req, res, next) {
  try {
    const { name, phone, village, avatarUrl } = req.body;
    const user = req.user;
    if (name) user.name = String(name).trim();
    if (phone !== undefined) user.phone = String(phone).trim();
    if (village !== undefined) user.village = String(village).trim();
    if (avatarUrl !== undefined) user.avatarUrl = String(avatarUrl).trim();
    await user.save();

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
    req.user.avatarUrl = `/assets/uploads/${req.file.filename}`;
    await req.user.save();
    res.json({ success: true, avatarUrl: req.user.avatarUrl, user: req.user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  me,
  updateProfile,
  changePassword,
  uploadAvatar
};
